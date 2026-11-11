package browser

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestInteractiveLoginClosesBrowserAndRetainsSessionCookies(t *testing.T) {
	executable := testChrome(t)
	var lmsAddress atomic.Value
	var sessions, ssoVersion atomic.Int32
	var firstLogin atomic.Bool
	firstLogin.Store(true)
	ssoSystem := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		cookie, err := r.Cookie("sso")
		if !firstLogin.Swap(false) &&
			(err != nil || cookie.Value != fmt.Sprint(ssoVersion.Load())) {
			http.Error(w, "Authentication required", http.StatusUnauthorized)
			return
		}
		// No MaxAge or Expires: both SSO and LMS use session cookies.
		http.SetCookie(
			w,
			&http.Cookie{
				Name:     "sso",
				Value:    fmt.Sprint(ssoVersion.Add(1)),
				Path:     "/",
				HttpOnly: true,
			},
		)
		http.Redirect(w, r, lmsAddress.Load().(string)+"/ticket", http.StatusFound)
	}))
	defer ssoSystem.Close()
	ssoURL := strings.Replace(ssoSystem.URL, "127.0.0.1", "localhost", 1)
	lms := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		cookie, err := r.Cookie("lms-session")
		switch r.URL.Path {
		case "/ticket":
			http.SetCookie(
				w,
				&http.Cookie{
					Name:     "lms-session",
					Value:    fmt.Sprint(sessions.Add(1)),
					Path:     "/",
					HttpOnly: true,
				},
			)
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
			fmt.Fprintf(
				w,
				`<p>統合認証アカウントでログインします</p><form action="%s"><button name="loginButton">Login</button></form>`,
				ssoURL,
			)
		case "/lms/homeHoml/doIndex":
			if err != nil {
				http.Redirect(w, r, "/lms/error/notLogin", http.StatusFound)
				return
			}
			fmt.Fprintf(
				w,
				`<body data-session="%s"><span class="lms-search-condition-title">講義一覧</span><div class="lms-weekly-area"></div></body>`,
				cookie.Value,
			)
		default:
			http.NotFound(w, r)
		}
	}))
	defer lms.Close()
	lmsAddress.Store(lms.URL)
	dir := t.TempDir()
	opts := Options{
		StateDir:   filepath.Join(dir, "state"),
		CacheDir:   filepath.Join(dir, "cache"),
		Executable: executable,
		LMSURL:     lms.URL,
		SSOURL:     ssoURL,
	}
	b, err := New(opts)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = b.Close() })
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
	if b.root == nil || b.root == loginRoot || b.interactive || loginRoot.Err() == nil {
		t.Fatal("interactive login browser was not replaced by a headless browser")
	}
	if ok, err := b.Status(ctx); err != nil || !ok {
		t.Fatal("session lost after login", ok, err)
	}
	if sessions.Load() == 0 {
		t.Fatal("no LMS session was created")
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
}
