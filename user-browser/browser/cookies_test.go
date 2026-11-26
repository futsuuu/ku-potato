package browser

import (
	"bytes"
	"context"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/chromedp/cdproto/cdp"
	"github.com/chromedp/cdproto/network"
	"github.com/chromedp/cdproto/storage"
	"github.com/chromedp/cdproto/target"
	cd "github.com/chromedp/chromedp"
)

func TestCookiesSurviveRuntimeFailureAndProfileReplacement(t *testing.T) {
	dir := t.TempDir()
	opts := Options{StateDir: dir, CacheDir: filepath.Join(dir, "cache"), Executable: testChrome(t)}
	b := newTestBrowser(t, opts)
	ctx, cancel := context.WithTimeout(t.Context(), time.Minute)
	defer cancel()
	var want []*network.Cookie
	err := b.withSessionAuth(ctx, false, false, func(tab context.Context) error {
		exec := cdp.WithExecutor(tab, cd.FromContext(tab).Browser)
		if err := storage.SetCookies([]*network.CookieParam{
			{
				Name: "session", Value: "signed-in", Domain: "auth.example.test", Path: "/login",
				Secure: true, HTTPOnly: true, SameSite: network.CookieSameSiteStrict,
				Priority:     network.CookiePriorityHigh,
				SourceScheme: network.CookieSourceSchemeSecure, SourcePort: 443,
			},
			{
				Name: "persistent", Value: "remembered", Domain: ".example.test", Path: "/",
				Secure: true, SameSite: network.CookieSameSiteNone,
				Expires: ptrExpiry(time.Now().Add(time.Hour).Truncate(time.Second)),
				PartitionKey: &network.CookiePartitionKey{
					TopLevelSite: "https://example.test", HasCrossSiteAncestor: true,
				},
			},
		}).Do(exec); err != nil {
			return err
		}
		var err error
		want, err = storage.GetCookies().Do(exec)
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(want) != 2 {
		t.Fatal("fixture did not set both cookies", len(want))
	}
	if b.cookiePath() != filepath.Join(dir, "auth", "cookies.json") {
		t.Fatal("cookie snapshot is not separate from the browser profile", b.cookiePath())
	}
	if _, err := os.Stat(b.cookiePath()); err != nil {
		t.Fatal("operation did not checkpoint cookies", err)
	}
	// Kill the runtime without its shutdown snapshot. A new profile must be
	// able to restore the last operation's checkpoint, not Chrome's database.
	b.cancelRoot()
	if err := b.Close(); err != nil {
		t.Fatal(err)
	}
	opts.ProfileDir = filepath.Join(dir, "fresh-profile")
	b = newTestBrowser(t, opts)
	if err := b.start(ctx, false); err != nil {
		t.Fatal(err)
	}
	got, err := storage.GetCookies().Do(cdp.WithExecutor(b.root, cd.FromContext(b.root).Browser))
	if err != nil || len(got) != len(want) {
		t.Fatal("cookie snapshot was not restored", len(got), err)
	}
	byName := func(a, b *network.Cookie) int { return strings.Compare(a.Name, b.Name) }
	slices.SortFunc(want, byName)
	slices.SortFunc(got, byName)
	for index, cookie := range got {
		if !reflect.DeepEqual(cookie, want[index]) {
			t.Errorf("cookie attributes changed: got %+v, want %+v", cookie, want[index])
		}
	}
}

func TestCookieSnapshotsTrackCancelledOperationsAndLogout(t *testing.T) {
	dir := t.TempDir()
	opts := Options{StateDir: dir, CacheDir: filepath.Join(dir, "cache"), Executable: testChrome(t)}
	b := newTestBrowser(t, opts)
	ctx, cancel := context.WithTimeout(t.Context(), time.Minute)
	defer cancel()
	if err := b.withSessionAuth(ctx, false, false, func(tab context.Context) error {
		return storage.SetCookies([]*network.CookieParam{
			{Name: "session", Value: "old", Domain: "example.test", Path: "/"},
			{Name: "obsolete", Value: "old", Domain: "example.test", Path: "/"},
		}).Do(cdp.WithExecutor(tab, cd.FromContext(tab).Browser))
	}); err != nil {
		t.Fatal(err)
	}
	request, cancelRequest := context.WithCancel(ctx)
	defer cancelRequest()
	err := b.withSessionAuth(request, false, false, func(tab context.Context) error {
		exec := cdp.WithExecutor(tab, cd.FromContext(tab).Browser)
		if err := storage.ClearCookies().Do(exec); err != nil {
			return err
		}
		if err := storage.SetCookies([]*network.CookieParam{
			{Name: "session", Value: "rotated", Domain: "example.test", Path: "/"},
		}).Do(exec); err != nil {
			return err
		}
		cancelRequest()
		return request.Err()
	})
	if !errors.Is(err, context.Canceled) {
		t.Fatal("request was not cancelled", err)
	}
	cookies, err := b.loadCookies()
	if err != nil || len(cookies) != 1 || cookies[0].Name != "session" ||
		cookies[0].Value != "rotated" {
		t.Fatal("cancelled operation did not persist cookie rotation and deletion", cookies, err)
	}
	if err := b.withSessionAuth(ctx, false, false, func(tab context.Context) error {
		if err := storage.ClearCookies().
			Do(cdp.WithExecutor(tab, cd.FromContext(tab).Browser)); err != nil {
			return err
		}
		return Fail("authentication-required", "signed out")
	}); err == nil {
		t.Fatal("failed authentication was accepted")
	}
	cookies, err = b.loadCookies()
	if err != nil || len(cookies) != 0 {
		t.Fatal("logout did not replace the snapshot with an empty jar", cookies, err)
	}
	// Simulate stale persistent profile cookies that are newer than the last
	// checkpoint. Restoring an empty snapshot must not resurrect them.
	exec := cdp.WithExecutor(b.root, cd.FromContext(b.root).Browser)
	if err := storage.SetCookies([]*network.CookieParam{
		{
			Name: "stale", Value: "signed-in", Domain: "example.test", Path: "/",
			Expires: ptrExpiry(time.Now().Add(time.Hour)),
		},
	}).Do(exec); err != nil {
		t.Fatal(err)
	}
	if err := cd.Cancel(b.root); err != nil {
		t.Fatal(err)
	}
	if err := b.Close(); err != nil {
		t.Fatal(err)
	}
	b = newTestBrowser(t, opts)
	if err := b.start(ctx, false); err != nil {
		t.Fatal(err)
	}
	cookiesInBrowser, err := storage.GetCookies().
		Do(cdp.WithExecutor(b.root, cd.FromContext(b.root).Browser))
	if err != nil || len(cookiesInBrowser) != 0 {
		t.Fatal("stale profile cookies were restored after logout", cookiesInBrowser, err)
	}
}

func TestClosedAuthWindowPreservesCookies(t *testing.T) {
	for _, test := range []struct {
		name    string
		kind    authPageKind
		active  bool
		timeout bool
	}{
		{"shared-cancelled", sharedAuthPage, true, false},
		{"shared-timeout", sharedAuthPage, true, true},
		{"dedicated-cancelled", dedicatedAuthPage, true, false},
		{"shared-idle-shutdown", sharedAuthPage, false, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			b, ctx := windowTestBrowser(t)
			before, err := os.ReadFile(b.cookiePath())
			if err != nil {
				t.Fatal(err)
			}
			var request context.Context
			var cancelRequest context.CancelFunc
			if test.timeout {
				request, cancelRequest = context.WithTimeout(ctx, 2*time.Second)
			} else {
				request, cancelRequest = context.WithCancel(ctx)
			}
			defer cancelRequest()
			var id target.ID
			err = b.withProviderAuth(
				request,
				true,
				test.kind,
				false,
				func(tab context.Context) error {
					id = cd.FromContext(tab).Target.TargetID
					if test.active {
						if err := storage.SetCookies([]*network.CookieParam{
							{
								Name:   "unfinished",
								Value:  "pending",
								Domain: "google.example.test",
								Path:   "/",
							},
						}).Do(cdp.WithExecutor(tab, cd.FromContext(tab).Browser)); err != nil {
							return err
						}
						closeAuthPage(t, b, id)
						if test.timeout {
							<-request.Done()
						} else {
							cancelRequest()
						}
						return request.Err()
					}
					return Fail("authentication-required", "fixture failure")
				},
			)
			if id == "" {
				t.Fatal("fixture did not open an authentication page", err)
			}
			wantError := context.Canceled
			if test.timeout {
				wantError = context.DeadlineExceeded
			}
			if test.active && !errors.Is(err, wantError) {
				t.Fatal("request cancellation or timeout was lost", err)
			}
			if !test.active {
				if id == "" || err == nil {
					t.Fatal("fixture did not leave a failed authentication page", err)
				}
				closeAuthPage(t, b, id)
			}
			if err := b.Close(); err != nil {
				t.Fatal(err)
			}
			after, err := os.ReadFile(b.cookiePath())
			if err != nil || !bytes.Equal(after, before) {
				t.Fatal("window closure overwrote another provider's saved session", err)
			}
		})
	}
}

func TestLogoutWithOpenAuthWindowIsPersisted(t *testing.T) {
	b, ctx := windowTestBrowser(t)
	var id target.ID
	err := b.withProviderAuth(ctx, true, sharedAuthPage, false, func(tab context.Context) error {
		id = cd.FromContext(tab).Target.TargetID
		if err := storage.ClearCookies().
			Do(cdp.WithExecutor(tab, cd.FromContext(tab).Browser)); err != nil {
			return err
		}
		return Fail("authentication-required", "signed out")
	})
	if failure, ok := errors.AsType[*Error](
		err,
	); !ok || failure.Reason != "authentication-required" ||
		id == "" {
		t.Fatal("fixture did not log out", err)
	}
	cookies, err := b.loadCookies()
	if err != nil || len(cookies) != 0 {
		t.Fatal("logout was mistaken for a closed window", len(cookies), err)
	}
	closeAuthPage(t, b, id)
	if err := b.Close(); err != nil {
		t.Fatal(err)
	}
	cookies, err = b.loadCookies()
	if err != nil || len(cookies) != 0 {
		t.Fatal("window closure resurrected logged-out cookies", len(cookies), err)
	}
}

func TestLoadCookiesSkipsExpiredCookies(t *testing.T) {
	dir := t.TempDir()
	b := newTestBrowser(t, Options{StateDir: dir, CacheDir: filepath.Join(dir, "cache")})
	if cookies, err := b.loadCookies(); err != nil || len(cookies) != 0 {
		t.Fatal("missing cookie snapshot should be an empty jar", cookies, err)
	}
	if err := os.MkdirAll(filepath.Dir(b.cookiePath()), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := atomicJSON(b.cookiePath(), []*network.CookieParam{
		{Name: "session", Value: "live", Domain: "example.test", Path: "/"},
		{
			Name: "expired", Value: "old", Domain: "example.test", Path: "/",
			Expires: ptrExpiry(time.Now().Add(-time.Hour)),
		},
		{
			Name: "persistent", Value: "live", Domain: "example.test", Path: "/",
			Expires: ptrExpiry(time.Now().Add(time.Hour)),
		},
	}); err != nil {
		t.Fatal(err)
	}
	cookies, err := b.loadCookies()
	if err != nil || len(cookies) != 2 || cookies[0].Name != "session" ||
		cookies[0].Expires != nil || cookies[1].Name != "persistent" {
		t.Fatal("expired cookie was retained or session lifetime was changed", cookies, err)
	}
	for _, body := range []string{
		"private-secret", `[null]`, `[{"name":"session","value":"private-secret"}]`,
	} {
		if err := os.WriteFile(b.cookiePath(), []byte(body), 0o600); err != nil {
			t.Fatal(err)
		}
		_, err := b.loadCookies()
		failure, ok := errors.AsType[*Error](err)
		if !ok || failure.Reason != "authentication-storage" ||
			strings.Contains(err.Error(), "private-secret") {
			t.Fatal("invalid cookie snapshot was accepted or leaked", err)
		}
	}
}

func TestFailedCookieRestoreDoesNotOverwriteSnapshot(t *testing.T) {
	dir := t.TempDir()
	b := newTestBrowser(t, Options{
		StateDir: dir, CacheDir: filepath.Join(dir, "cache"), Executable: testChrome(t),
	})
	if err := os.MkdirAll(filepath.Dir(b.cookiePath()), 0o700); err != nil {
		t.Fatal(err)
	}
	const body = "invalid-private-secret"
	if err := os.WriteFile(b.cookiePath(), []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(t.Context(), time.Minute)
	defer cancel()
	err := b.start(ctx, false)
	if failure, ok := errors.AsType[*Error](
		err,
	); !ok ||
		failure.Reason != "authentication-storage" {
		t.Fatal("invalid cookie snapshot did not fail startup", err)
	}
	if b.root != nil || b.cookiesReady {
		t.Fatal("failed startup did not release the browser")
	}
	if err := b.Close(); err != nil {
		t.Fatal(err)
	}
	stored, err := os.ReadFile(b.cookiePath())
	if err != nil || string(stored) != body {
		t.Fatal("failed startup overwrote the cookie snapshot", err)
	}
}

func TestCookieSaveFailureStillStopsBrowser(t *testing.T) {
	dir := t.TempDir()
	b := newTestBrowser(t, Options{
		StateDir: dir, CacheDir: filepath.Join(dir, "cache"), Executable: testChrome(t),
	})
	ctx, cancel := context.WithTimeout(t.Context(), time.Minute)
	defer cancel()
	if err := b.start(ctx, false); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(b.cookiePath(), 0o700); err != nil {
		t.Fatal(err)
	}
	err := b.withSessionAuth(ctx, false, false, func(context.Context) error { return nil })
	if failure, ok := errors.AsType[*Error](
		err,
	); !ok ||
		failure.Reason != "authentication-storage" {
		t.Fatal("cookie save failure was not reported", err)
	}
	err = b.Close()
	if failure, ok := errors.AsType[*Error](
		err,
	); !ok ||
		failure.Reason != "authentication-storage" {
		t.Fatal("shutdown cookie save failure was not reported", err)
	}
	if b.root != nil || b.cookiesReady {
		t.Fatal("cookie save failure prevented browser cleanup")
	}
}
