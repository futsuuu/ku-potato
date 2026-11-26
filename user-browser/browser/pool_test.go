package browser

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/chromedp/cdproto/browser"
	"github.com/chromedp/cdproto/cdp"
	"github.com/chromedp/cdproto/network"
	"github.com/chromedp/cdproto/storage"
	"github.com/chromedp/cdproto/target"
	cd "github.com/chromedp/chromedp"
)

func windowTestBrowser(t *testing.T) (*Browser, context.Context) {
	t.Helper()
	dir := t.TempDir()
	b := newTestBrowser(t, Options{
		StateDir: dir, CacheDir: filepath.Join(dir, "cache"), Executable: testChrome(t),
	})
	ctx, cancel := context.WithTimeout(t.Context(), time.Minute)
	t.Cleanup(cancel)
	if err := b.start(ctx, os.Getenv("KU_POTATO_TEST_HEADED") == "1"); err != nil {
		t.Fatal(err)
	}
	// Exercise the interactive path without opening real windows by default.
	b.interactive = true
	exec := cdp.WithExecutor(b.root, cd.FromContext(b.root).Browser)
	if err := storage.SetCookies([]*network.CookieParam{
		{Name: "sso", Value: "saved", Domain: "sso.example.test", Path: "/", HTTPOnly: true},
		{
			Name: "persistent", Value: "saved", Domain: "other.example.test", Path: "/",
			Expires: ptrExpiry(time.Now().Add(time.Hour)),
		},
	}).Do(exec); err != nil {
		t.Fatal(err)
	}
	if saved, err := b.saveCookies(); err != nil || !saved {
		t.Fatal("fixture did not checkpoint cookies", saved, err)
	}
	return b, ctx
}

func closeAuthPage(t *testing.T, b *Browser, id target.ID) {
	t.Helper()
	ctx, cancel := context.WithTimeout(b.root, 5*time.Second)
	defer cancel()
	exec := cdp.WithExecutor(ctx, cd.FromContext(ctx).Browser)
	// Close the browser target, not its Go context, just like closing its only
	// tab/window through the browser UI. The windowless browser stays running.
	if err := target.CloseTarget(id).Do(exec); err != nil {
		t.Fatal(err)
	}
	for {
		pages := authPageTargets(t, ctx)
		cookies, err := storage.GetCookies().Do(exec)
		if err != nil {
			t.Fatal(err)
		}
		lostSession := true
		for _, cookie := range cookies {
			if cookie.Name == "sso" {
				lostSession = false
			}
		}
		closed := true
		for _, page := range pages {
			if page.TargetID == id {
				closed = false
			}
		}
		if closed && (len(pages) > 0 || os.Getenv("KU_POTATO_TEST_HEADED") != "1" || lostSession) {
			break
		}
		select {
		case <-ctx.Done():
			t.Fatal("closing the last ordinary window did not finish", ctx.Err())
		case <-time.After(10 * time.Millisecond):
		}
	}
	if b.root.Err() != nil {
		t.Fatal("fixture did not retain the windowless browser", b.root.Err())
	}
}

func TestOperationContextTracksTargetLifetime(t *testing.T) {
	for _, page := range []struct {
		name string
		kind authPageKind
	}{
		{"shared", sharedAuthPage},
		{"dedicated", dedicatedAuthPage},
		{"isolated", isolatedAuthPage},
	} {
		t.Run(page.name, func(t *testing.T) {
			b, request := windowTestBrowser(t)
			tab, closeTab, err := b.authPage(request, page.kind)
			if err != nil {
				t.Fatal(err)
			}
			defer closeTab()
			op, cancel := operationContext(tab, request)
			defer cancel()
			other, closeOther, err := b.authPage(request, dedicatedAuthPage)
			if err != nil {
				t.Fatal(err)
			}
			defer closeOther()
			otherOp, cancelOther := operationContext(other, request)
			defer cancelOther()
			exec := cdp.WithExecutor(request, cd.FromContext(b.root).Browser)
			if err := target.CloseTarget(cd.FromContext(other).Target.TargetID).
				Do(exec); err != nil {
				t.Fatal(err)
			}
			select {
			case <-otherOp.Done():
			case <-time.After(5 * time.Second):
				t.Fatal("closing a target did not cancel its operation")
			}
			if op.Err() != nil {
				t.Fatal("closing another target cancelled the active operation", op.Err())
			}
			if err := target.CloseTarget(cd.FromContext(tab).Target.TargetID).Do(exec); err != nil {
				t.Fatal(err)
			}
			select {
			case <-op.Done():
			case <-time.After(5 * time.Second):
				t.Fatal("closing the active target did not cancel its operation")
			}
			if !errors.Is(op.Err(), context.Canceled) || request.Err() != nil ||
				tab.Err() != nil || b.root.Err() != nil {
				t.Fatal(
					"target closure must cancel only the operation",
					op.Err(),
					request.Err(),
					tab.Err(),
					b.root.Err(),
				)
			}
		})
	}
}

func TestClosedAuthenticationWindowDoesNotReportStorageFailure(t *testing.T) {
	for _, kind := range []authPageKind{sharedAuthPage, dedicatedAuthPage, isolatedAuthPage} {
		b, request := windowTestBrowser(t)
		err := b.withProviderAuth(request, true, kind, false, func(op context.Context) error {
			exec := cdp.WithExecutor(request, cd.FromContext(b.root).Browser)
			if err := target.CloseTarget(cd.FromContext(op).Target.TargetID).Do(exec); err != nil {
				t.Fatal(err)
			}
			select {
			case <-op.Done():
			case <-time.After(5 * time.Second):
				t.Fatal("window closure did not cancel the operation")
			}
			return Fail(
				"authentication-storage",
				"could not read credentials from the closed target",
			)
		})
		if !errors.Is(err, context.Canceled) || request.Err() != nil {
			t.Fatal("closed window was not classified as cancellation", kind, err)
		}
	}
}

func TestAuthenticationPageLifecycle(t *testing.T) {
	executable := testChrome(t)
	// Opt in to real windows when checking Chrome/Edge's headed lifecycle.
	interactive := os.Getenv("KU_POTATO_TEST_HEADED") == "1"
	for _, page := range []struct {
		name string
		kind authPageKind
	}{
		{"shared", sharedAuthPage},
		{"dedicated", dedicatedAuthPage},
		{"isolated", isolatedAuthPage},
	} {
		for _, outcome := range []string{"success", "failure", "cancelled"} {
			t.Run(page.name+"/"+outcome, func(t *testing.T) {
				dir := t.TempDir()
				b := newTestBrowser(t, Options{
					StateDir: dir, CacheDir: filepath.Join(dir, "cache"), Executable: executable,
				})
				ctx, cancel := context.WithTimeout(t.Context(), 30*time.Second)
				defer cancel()
				if err := b.start(ctx, interactive); err != nil {
					t.Fatal(err)
				}
				if pages := authPageTargets(
					t,
					b.root,
				); len(pages) != 0 ||
					cd.FromContext(b.root).Target != nil {
					t.Fatal("startup created an unused page", len(pages))
				}
				exec := cdp.WithExecutor(b.root, cd.FromContext(b.root).Browser)
				cookie := &network.CookieParam{
					Name:     "session",
					Value:    "before",
					Domain:   "example.test",
					Path:     "/",
					HTTPOnly: true,
				}
				if err := storage.SetCookies([]*network.CookieParam{cookie}).Do(exec); err != nil {
					t.Fatal(err)
				}
				request, cancelRequest := context.WithCancel(ctx)
				defer cancelRequest()
				called := false
				err := b.withProviderAuth(
					request,
					interactive,
					page.kind,
					false,
					func(tab context.Context) error {
						called = true
						pages := authPageTargets(t, tab)
						if len(pages) != 1 ||
							pages[0].TargetID != cd.FromContext(tab).Target.TargetID {
							t.Fatal("authentication created an extra page", len(pages))
						}
						contexts, _, err := target.GetBrowserContexts().Do(exec)
						if err != nil {
							return err
						}
						if page.kind == isolatedAuthPage {
							if len(contexts) != 1 || contexts[0] != pages[0].BrowserContextID {
								t.Fatal("authentication is not isolated")
							}
						} else if len(contexts) != 0 {
							t.Fatal("ordinary authentication opened an isolated context")
						}
						if _, _, err := browser.GetWindowForTarget().
							WithTargetID(pages[0].TargetID).
							Do(exec); err != nil {
							return err
						}
						var value int
						if err := cd.Run(
							tab,
							cd.Evaluate("1 + 1", &value),
						); err != nil ||
							value != 2 {
							t.Fatal("authentication page is not operable", value, err)
						}
						if page.kind == isolatedAuthPage {
							cookies, err := storage.GetCookies().
								WithBrowserContextID(pages[0].BrowserContextID).
								Do(exec)
							if err != nil || len(cookies) != 0 {
								t.Fatal(
									"isolated page inherited another provider's cookies",
									len(cookies),
									err,
								)
							}
						}
						cookie.Value = "after"
						if err := storage.SetCookies([]*network.CookieParam{cookie}).
							Do(exec); err != nil {
							return err
						}
						switch outcome {
						case "failure":
							return Fail("authentication-required", "fixture failure")
						case "cancelled":
							cancelRequest()
							return request.Err()
						}
						return nil
					},
				)
				if !called {
					t.Fatal("authentication did not reach its page", err)
				}
				switch outcome {
				case "success":
					if err != nil {
						t.Fatal(err)
					}
				case "failure":
					if failure, ok := errors.AsType[*Error](
						err,
					); !ok ||
						failure.Reason != "authentication-required" {
						t.Fatal("authentication error was lost", err)
					}
				case "cancelled":
					if !errors.Is(err, context.Canceled) {
						t.Fatal("request cancellation was lost", err)
					}
				}
				stopped := page.kind == dedicatedAuthPage ||
					interactive && (outcome == "success" || page.kind == isolatedAuthPage)
				if (b.root == nil) != stopped {
					t.Fatal("unexpected authentication runtime lifetime", stopped)
				}
				if b.root != nil {
					wantPages := 0
					if page.kind == sharedAuthPage {
						wantPages = 1
					}
					if pages := authPageTargets(t, b.root); len(pages) != wantPages {
						t.Fatal("authentication leaked a page", len(pages), wantPages)
					}
					contexts, _, err := target.GetBrowserContexts().Do(exec)
					if err != nil || len(contexts) != 0 {
						t.Fatal("authentication leaked an isolated context", len(contexts), err)
					}
				}
				for _, closeRuntime := range []bool{false, true} {
					if closeRuntime {
						if err := b.Close(); err != nil {
							t.Fatal(err)
						}
					}
					cookies, err := b.loadCookies()
					if err != nil || len(cookies) != 1 || cookies[0].Value != "after" ||
						cookies[0].Expires != nil {
						t.Fatal("closing the last window lost session cookies", len(cookies), err)
					}
				}
			})
		}
	}
}

func authPageTargets(t *testing.T, ctx context.Context) []*target.Info {
	t.Helper()
	targets, err := target.GetTargets().Do(cdp.WithExecutor(ctx, cd.FromContext(ctx).Browser))
	if err != nil {
		t.Fatal(err)
	}
	var pages []*target.Info
	for _, info := range targets {
		if info.Type == "page" {
			pages = append(pages, info)
		}
	}
	return pages
}

func TestClosedSharedPageIsRecreated(t *testing.T) {
	for _, otherTab := range []bool{false, true} {
		name := "last-tab"
		if otherTab {
			name = "other-tab-open"
		}
		t.Run(name, func(t *testing.T) {
			b, ctx := windowTestBrowser(t)
			interactive := os.Getenv("KU_POTATO_TEST_HEADED") == "1"
			b.interactive = interactive
			if err := b.withProviderAuth(
				ctx,
				interactive,
				sharedAuthPage,
				false,
				func(context.Context) error {
					return Fail("authentication-required", "fixture failure")
				},
			); err == nil {
				t.Fatal("fixture did not leave a failed authentication page")
			}
			oldRoot := b.root
			oldID := cd.FromContext(b.page).Target.TargetID
			exec := cdp.WithExecutor(ctx, cd.FromContext(b.root).Browser)
			window, _, err := browser.GetWindowForTarget().WithTargetID(oldID).Do(exec)
			if err != nil {
				t.Fatal(err)
			}
			wantPages := 1
			if otherTab {
				if _, err := target.CreateTarget("about:blank").Do(exec); err != nil {
					t.Fatal(err)
				}
				wantPages++
			}
			closeAuthPage(t, b, oldID)
			called := false
			err = b.withProviderAuth(
				ctx,
				interactive,
				sharedAuthPage,
				false,
				func(tab context.Context) error {
					called = true
					if cd.FromContext(tab).Target.TargetID == oldID ||
						(b.root == oldRoot) != otherTab {
						t.Fatal("retry reused a closed target or the wrong browser session")
					}
					if pages := authPageTargets(t, tab); len(pages) != wantPages {
						t.Fatal("retry created extra authentication pages", len(pages), wantPages)
					}
					exec := cdp.WithExecutor(tab, cd.FromContext(tab).Browser)
					if otherTab {
						actual, _, err := browser.GetWindowForTarget().
							WithTargetID(cd.FromContext(tab).Target.TargetID).
							Do(exec)
						if err != nil || actual != window {
							t.Fatal("retry opened an unnecessary window", err)
						}
					}
					cookies, err := storage.GetCookies().Do(exec)
					if err != nil || len(cookies) != 2 {
						t.Fatal("retry did not restore saved provider cookies", len(cookies), err)
					}
					for _, cookie := range cookies {
						if cookie.Value != "saved" ||
							cookie.Name != "sso" && cookie.Name != "persistent" {
							t.Fatal("retry changed a saved provider cookie")
						}
					}
					return nil
				},
			)
			if err != nil || !called {
				t.Fatal("closed authentication page prevented retry", called, err)
			}
		})
	}
}

func TestRestartsKeepNoTabsAndSessionCookies(t *testing.T) {
	dir := t.TempDir()
	b, err := New(Options{
		StateDir: dir, CacheDir: filepath.Join(dir, "cache"), Executable: testChrome(t),
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = b.Close() })
	ctx, cancel := context.WithTimeout(t.Context(), time.Minute)
	defer cancel()
	if err := b.start(ctx, false); err != nil {
		t.Fatal(err)
	}
	exec := cdp.WithExecutor(b.root, cd.FromContext(b.root).Browser)
	if err := storage.SetCookies([]*network.CookieParam{{
		Name: "session", Value: "signed-in", Domain: "example.com", Path: "/", HTTPOnly: true,
	}}).Do(exec); err != nil {
		t.Fatal(err)
	}
	// Leave extra tabs in the profile, as an earlier runtime or a user can do.
	for range 2 {
		if _, err := target.CreateTarget("about:blank").WithNewWindow(true).Do(exec); err != nil {
			t.Fatal(err)
		}
	}
	for restart := range 3 {
		if err := b.stopRuntime(); err != nil {
			t.Fatal(err)
		}
		if err := b.start(ctx, false); err != nil {
			t.Fatal(err)
		}
		exec := cdp.WithExecutor(b.root, cd.FromContext(b.root).Browser)
		pages, err := target.GetTargets().Do(exec)
		if err != nil {
			t.Fatal(err)
		}
		var tabs int
		for _, page := range pages {
			if page.Type == "page" {
				tabs++
				t.Errorf("restart %d retained a tab: %s", restart, page.URL)
			}
		}
		if tabs != 0 || cd.FromContext(b.root).Target != nil {
			t.Fatalf("restart %d has %d tabs, want 0", restart, tabs)
		}
		cookies, err := storage.GetCookies().Do(exec)
		if err != nil || len(cookies) != 1 || cookies[0].Name != "session" ||
			cookies[0].Value != "signed-in" || !cookies[0].Session {
			t.Fatal("restart lost the session cookie", cookies, err)
		}
		if err := b.withSessionAuth(ctx, false, false, func(tab context.Context) error {
			return cd.Run(tab, cd.Evaluate("1 + 1", nil))
		}); err != nil {
			t.Fatal("could not create a usable page on demand", err)
		}
	}
}
