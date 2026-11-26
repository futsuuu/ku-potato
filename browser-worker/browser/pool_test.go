package browser

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"testing"
	"time"

	"github.com/chromedp/cdproto/browser"
	"github.com/chromedp/cdproto/cdp"
	cd "github.com/chromedp/chromedp"
	workerproto "github.com/futsuuu/ku-potato/browser-worker/protocol"
	"go.opentelemetry.io/otel/trace"
)

func TestSourceErrorPreservesCancellationAndTimeouts(t *testing.T) {
	for _, cause := range []error{context.Canceled, context.DeadlineExceeded} {
		err := fmt.Errorf("private diagnostics: %w", cause)
		if result := sourceError(context.Background(), err); !errors.Is(result, cause) {
			t.Fatal("context error was replaced by a source failure", result)
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	result := sourceError(
		ctx,
		Fail(workerproto.FailureReason_FAILURE_REASON_SOURCE, "browser failure"),
	)
	if !errors.Is(result, context.Canceled) {
		t.Fatal("request cancellation was misclassified", result)
	}
	deadline, cancelDeadline := context.WithDeadline(
		context.Background(),
		time.Now().Add(-time.Second),
	)
	defer cancelDeadline()
	result = sourceError(deadline, context.Canceled)
	if !errors.Is(result, context.DeadlineExceeded) {
		t.Fatal("request timeout was reported as cancellation", result)
	}
}

func TestOperationContextPreservesPageAndRequestSpan(t *testing.T) {
	page, closePage := cd.NewContext(t.Context())
	defer closePage()
	span := trace.NewSpanContext(trace.SpanContextConfig{
		TraceID: trace.TraceID{1},
		SpanID:  trace.SpanID{2},
	})
	request, cancel := context.WithCancel(trace.ContextWithSpanContext(t.Context(), span))
	op, stop := operationContext(page, request)
	defer stop()
	if cd.FromContext(op) != cd.FromContext(page) {
		t.Fatal("operation lost the page context")
	}
	if !trace.SpanContextFromContext(op).Equal(span) {
		t.Fatal("operation lost the request span")
	}
	cancel()
	select {
	case <-op.Done():
	case <-time.After(time.Second):
		t.Fatal("request cancellation did not stop the operation")
	}
	if page.Err() != nil {
		t.Fatal("request cancellation stopped the page")
	}
	op, stop = operationContext(page, t.Context())
	stop()
	if op.Err() == nil || page.Err() != nil {
		t.Fatal("stopping the operation affected the page lifetime")
	}
	op, stop = operationContext(page, request)
	defer stop()
	if op.Err() == nil {
		t.Fatal("already cancelled request was ignored")
	}
}

func testChrome(t *testing.T) string {
	t.Helper()
	for _, name := range []string{"google-chrome", "chromium", "msedge", "chrome"} {
		if value, err := exec.LookPath(name); err == nil {
			return value
		}
	}
	for _, path := range []string{filepath.Join(os.Getenv("LOCALAPPDATA"), "Google", "Chrome", "Application", "chrome.exe"), `C:\Program Files\Google\Chrome\Application\chrome.exe`, `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`} {
		if _, err := os.Stat(path); err == nil {
			return path
		}
	}
	t.Skip("Chrome unavailable")
	return ""
}

func TestBrowserStartsWithoutAccountLinkingOrSessionRestore(t *testing.T) {
	b, err := New(
		Options{
			StateDir:    t.TempDir(),
			CacheDir:    t.TempDir(),
			DownloadDir: t.TempDir(),
			Executable:  testChrome(t),
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = b.Close() }()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := b.start(ctx); err != nil {
		t.Fatal(err)
	}
	op, stop := operationContext(b.root, ctx)
	defer stop()
	arguments, err := browser.GetBrowserCommandLine().
		Do(cdp.WithExecutor(op, cd.FromContext(b.root).Browser))
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Contains(arguments, "--allow-browser-signin=false") {
		t.Fatal("browser account linking was not disabled")
	}
	if slices.Contains(arguments, "--restore-last-session") {
		t.Fatal("worker browser must not restore the previous session")
	}
}

func TestFailedBrowserStartCanCloseAndRetry(t *testing.T) {
	dir := t.TempDir()
	b, err := New(
		Options{
			StateDir:    filepath.Join(dir, "state"),
			CacheDir:    filepath.Join(dir, "cache"),
			DownloadDir: filepath.Join(dir, "temp"),
			Executable:  filepath.Join(dir, "missing-chrome"),
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	done := make(chan error, 1)
	go func() {
		for range 2 {
			err := b.start(ctx)
			var failure *Failure
			if !errors.As(err, &failure) ||
				failure.Reason != workerproto.FailureReason_FAILURE_REASON_BROWSER_START {
				done <- fmt.Errorf("missing browser startup error: %w", err)
				return
			}
			if b.root != nil {
				done <- fmt.Errorf("failed runtime retained")
				return
			}
		}
		done <- b.Close()
	}()
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-ctx.Done():
		t.Fatal("failed browser startup blocked cleanup or retry")
	}
}

func TestOccupiedProfileReportsBrowserStartupFailure(t *testing.T) {
	opts := Options{
		StateDir:    t.TempDir(),
		CacheDir:    t.TempDir(),
		DownloadDir: t.TempDir(),
		Executable:  testChrome(t),
	}
	owner, err := New(opts)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = owner.Close() }()
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	if err := owner.start(ctx); err != nil {
		t.Fatal(err)
	}
	other, err := New(opts)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = other.Close() }()
	err = other.start(ctx)
	var failure *Failure
	if !errors.As(err, &failure) ||
		failure.Reason != workerproto.FailureReason_FAILURE_REASON_BROWSER_START {
		t.Fatalf("occupied profile startup error: %v", err)
	}
}

func TestPoolRetainsPagesAndIsolatesParallelLeases(t *testing.T) {
	executable := testChrome(t)
	lms := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/lms/homeRedirect/" {
			http.Redirect(w, r, "/lms/homeHoml/doIndex", http.StatusFound)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		fmt.Fprint(
			w,
			`<span class="lms-search-condition-title">講義一覧</span><div class="lms-weekly-area"></div>`,
		)
	}))
	defer lms.Close()
	dir := t.TempDir()
	b, err := New(
		Options{
			StateDir:    filepath.Join(dir, "state"),
			CacheDir:    filepath.Join(dir, "cache"),
			DownloadDir: filepath.Join(dir, "temp"),
			Executable:  executable,
			LMSURL:      lms.URL,
			Parallelism: 2,
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = b.Close() })
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	type identity struct {
		page, context string
		browser       *cd.Browser
	}
	identities := make(chan identity, 2)
	release := make(chan struct{})
	done := make(chan error, 2)
	for range 2 {
		go func() {
			done <- b.withPage(ctx, func(tab context.Context) error {
				info := cd.FromContext(tab)
				id := identity{page: string(info.Target.TargetID), context: string(info.BrowserContextID), browser: info.Browser}
				if err := cd.Run(tab, cd.Evaluate("window.name="+js(id.page), nil)); err != nil {
					return err
				}
				identities <- id
				select {
				case <-release:
					return nil
				case <-tab.Done():
					return tab.Err()
				}
			})
		}()
	}
	ids := map[string]bool{}
	contexts := map[string]bool{}
	var instance *cd.Browser
	for range 2 {
		select {
		case id := <-identities:
			if id.context == "" {
				t.Fatal("default browser context used")
			}
			ids[id.page], contexts[id.context] = true, true
			if instance != nil && instance != id.browser {
				t.Fatal("multiple browser processes")
			}
			instance = id.browser
		case err := <-done:
			t.Fatalf("lease failed: %v", err)
		case <-ctx.Done():
			t.Fatal("parallel leases did not overlap")
		}
	}
	if len(ids) != 2 || len(contexts) != 2 {
		t.Fatal("parallel leases share a page/context", ids, contexts)
	}
	close(release)
	for range 2 {
		if err := <-done; err != nil {
			t.Fatal(err)
		}
	}
	for range 2 {
		err := b.withPage(ctx, func(tab context.Context) error {
			info := cd.FromContext(tab)
			var name string
			if err := cd.Run(tab, cd.Evaluate("window.name", &name)); err != nil {
				return err
			}
			if !ids[string(info.Target.TargetID)] || name != string(info.Target.TargetID) ||
				info.Browser != instance {
				return fmt.Errorf("page or browser was replaced")
			}
			return nil
		})
		if err != nil {
			t.Fatal(err)
		}
	}
	// Cancelling a request destroys its lease, while retaining the browser and
	// the other context. A later request gets a clean replacement for that page.
	request, cancelRequest := context.WithCancel(ctx)
	entered := make(chan struct{})
	go func() {
		done <- b.withPage(request, func(tab context.Context) error { close(entered); <-tab.Done(); return tab.Err() })
	}()
	select {
	case <-entered:
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	cancelRequest()
	if err := <-done; err == nil {
		t.Fatal("cancelled operation succeeded")
	}
	retained := 0
	for range 2 {
		if err := b.withPage(ctx, func(tab context.Context) error {
			info := cd.FromContext(tab)
			if info.Browser != instance {
				return fmt.Errorf("request cancellation killed the browser")
			}
			if ids[string(info.Target.TargetID)] {
				retained++
			}
			return nil
		}); err != nil {
			t.Fatal(err)
		}
	}
	if retained != 1 {
		t.Fatalf("retained %d pages; want one", retained)
	}
	// A failure in one page must return while another page is still working.
	leaseEntered, leaseRelease := make(chan struct{}), make(chan struct{})
	holdingDone := make(chan error, 1)
	go func() {
		holdingDone <- b.withPage(ctx, func(tab context.Context) error {
			close(leaseEntered)
			select {
			case <-leaseRelease:
				return nil
			case <-tab.Done():
				return tab.Err()
			}
		})
	}()
	select {
	case <-leaseEntered:
	case <-ctx.Done():
		close(leaseRelease)
		t.Fatal(ctx.Err())
	}
	failedDone := make(chan error, 1)
	go func() {
		failedDone <- b.withPage(ctx, func(context.Context) error { return fmt.Errorf("fixture failure") })
	}()
	select {
	case err := <-failedDone:
		if err == nil {
			t.Error("page failure was discarded")
		}
	case <-ctx.Done():
		t.Error("page failure waited for an unrelated operation")
	}
	close(leaseRelease)
	if err := <-holdingDone; err != nil {
		t.Fatal(err)
	}
}
