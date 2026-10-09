package chromedp

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	cd "github.com/chromedp/chromedp"
)

func TestInteractiveLoginClosesBrowserAndRetainsSessionCookies(t *testing.T) {
	executable := testChrome(t)
	var lmsAddress atomic.Value
	var sessions, ssoVersion atomic.Int32
	var firstLogin atomic.Bool
	firstLogin.Store(true)
	portal := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		cookie, err := r.Cookie("sso")
		if !firstLogin.Swap(false) && (err != nil || cookie.Value != fmt.Sprint(ssoVersion.Load())) {
			http.Error(w, "Authentication required", http.StatusUnauthorized)
			return
		}
		// No MaxAge or Expires: both SSO and LMS use session cookies.
		http.SetCookie(w, &http.Cookie{Name: "sso", Value: fmt.Sprint(ssoVersion.Add(1)), Path: "/", HttpOnly: true})
		http.Redirect(w, r, lmsAddress.Load().(string)+"/ticket", http.StatusFound)
	}))
	defer portal.Close()
	portalURL := strings.Replace(portal.URL, "127.0.0.1", "localhost", 1)
	lms := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		cookie, err := r.Cookie("lms-session")
		switch r.URL.Path {
		case "/ticket":
			http.SetCookie(w, &http.Cookie{Name: "lms-session", Value: fmt.Sprint(sessions.Add(1)), Path: "/", HttpOnly: true})
			http.Redirect(w, r, "/lms/homeHoml/doIndex", http.StatusFound)
		case "/lms/homeRedirect/":
			if err != nil {
				http.Redirect(w, r, "/lms/error/notLogin", http.StatusFound)
			} else {
				http.Redirect(w, r, "/lms/homeHoml/doIndex", http.StatusFound)
			}
		case "/lms/error/notLogin":
			http.Error(w, "Not logged in", http.StatusUnauthorized)
		case "/lms":
			fmt.Fprintf(w, `<p>統合認証アカウントでログインします</p><form action="%s"><button name="loginButton">Login</button></form>`, portalURL)
		case "/lms/homeHoml/doIndex":
			if err != nil {
				http.Error(w, "Not logged in", http.StatusUnauthorized)
				return
			}
			fmt.Fprintf(w, `<body data-session="%s"><span class="lms-search-condition-title">講義一覧</span><div class="lms-weekly-area"></div></body>`, cookie.Value)
		default:
			http.NotFound(w, r)
		}
	}))
	defer lms.Close()
	lmsAddress.Store(lms.URL)
	dir := t.TempDir()
	opts := Options{StateDir: filepath.Join(dir, "state"), CacheDir: filepath.Join(dir, "cache"), DownloadDir: filepath.Join(dir, "downloads"), Executable: executable, LMSURL: lms.URL, PortalURL: portalURL, Parallelism: 2}
	b, err := New(opts)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { b.Close() })
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	// Exercise interactive completion with a headless runtime so the test does
	// not open a window on the developer's desktop.
	if err := b.start(ctx, false); err != nil {
		t.Fatal(err)
	}
	b.interactive = true
	loginRoot := b.root
	if err := b.Login(ctx, true); err != nil {
		t.Fatal(err)
	}
	if b.root != nil || b.interactive || loginRoot.Err() == nil {
		t.Fatal("login browser was retained after HOME was verified")
	}
	if ok, err := b.Status(ctx); err != nil || !ok {
		t.Fatal("session lost after login", ok, err)
	}
	if sessions.Load() != 1 {
		t.Fatal("authentication check did not retain the LMS session", sessions.Load())
	}
	workerSessions := map[string]bool{}
	for range 2 {
		if err := b.withPage(ctx, func(tab context.Context) error {
			var session string
			if err := cd.Run(tab, cd.Evaluate("document.body.dataset.session", &session)); err != nil {
				return err
			}
			workerSessions[session] = true
			return nil
		}); err != nil {
			t.Fatal("worker lost SSO session", err)
		}
	}
	if len(workerSessions) != 2 || workerSessions["1"] {
		t.Fatal("LMS cookies were shared with workers", workerSessions)
	}
	if err := b.Close(); err != nil {
		t.Fatal(err)
	}
	b, err = New(opts)
	if err != nil {
		t.Fatal(err)
	}
	if ok, err := b.Status(ctx); err != nil || !ok {
		t.Fatal("session lost across server restart", ok, err)
	}
	if err := b.withPage(ctx, func(context.Context) error { return nil }); err != nil {
		t.Fatal("rotated SSO session was not saved", err)
	}
	if err := b.Logout(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(opts.StateDir, "cookies.json")); !os.IsNotExist(err) {
		t.Fatal("cookie snapshot retained after logout", err)
	}
	if ok, err := b.Status(ctx); err != nil || ok {
		t.Fatal("logged-out session was restored", ok, err)
	}
}
