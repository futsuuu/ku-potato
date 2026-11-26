package browser

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
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
	result := sourceError(ctx, Fail("authentication-storage", "cannot read cookies"))
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

func newTestBrowser(t *testing.T, opts Options) *Browser {
	t.Helper()
	b, err := New(opts)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = b.Close() })
	return b
}

func testChrome(t *testing.T) string {
	t.Helper()
	if path := os.Getenv("KU_POTATO_TEST_BROWSER"); path != "" {
		value, err := exec.LookPath(path)
		if err != nil {
			t.Fatal(err)
		}
		return value
	}
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
