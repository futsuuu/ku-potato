package tests

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	adapter "github.com/futsuuu/ku-potato/server/chromedp"
	"github.com/futsuuu/ku-potato/server/domain"
)

// The local fixture exercises expiry deterministically; this checks that the
// real SSO system currently accepts a session from a different Chrome profile.
func TestLiveIndependentProfiles(t *testing.T) {
	fixture := newLiveFixture(t)
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	lmsAuth := adapter.NewLMSAuthenticator(fixture.browser)
	if err := lmsAuth.Login(ctx, false); err != nil {
		t.Fatal("authenticate in the isolated inbound profile", err)
	}
	work, err := adapter.New(adapter.Options{
		StateDir: t.TempDir(), ProfileDir: t.TempDir(), CacheDir: t.TempDir(),
		DownloadDir: t.TempDir(), Executable: chrome(t), Parallelism: 1,
	})
	if err != nil {
		t.Fatal(err)
	}
	defer work.Close()
	if err := work.UseSSOCookies(lmsAuth); err != nil {
		t.Fatal(err)
	}
	if _, err := work.Courses(ctx); err != nil {
		t.Fatal("LMS login using only the inbound SSO session", err)
	}
}

// Exercise separate Chrome profiles end to end: cookie selection alone cannot
// verify independent LMS sessions, expiry recovery, or restart behavior.
func TestIndependentProfilesUseOnlySSOCookies(t *testing.T) {
	executable := chrome(t)
	var version atomic.Int32
	version.Store(1)
	var grant atomic.Bool
	grant.Store(true)
	var sessions atomic.Int32
	var lmsURL atomic.Value
	ssoSystem := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		cookie, err := r.Cookie("sso")
		valid := err == nil && cookie.Value == fmt.Sprint(version.Load())
		if !valid && grant.CompareAndSwap(true, false) {
			valid = true // An interactive user authorizes the authentication profile.
			http.SetCookie(w, &http.Cookie{Name: "sso", Value: fmt.Sprint(version.Load()), Path: "/", HttpOnly: true})
		}
		if !valid {
			w.WriteHeader(http.StatusUnauthorized)
			fmt.Fprint(w, "Authentication required")
			return
		}
		http.Redirect(w, r, lmsURL.Load().(string)+"/ticket", http.StatusFound)
	}))
	defer ssoSystem.Close()
	ssoURL := strings.Replace(ssoSystem.URL, "127.0.0.1", "localhost", 1)
	lms := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		session, err := r.Cookie("lms-session")
		valid := err == nil && strings.HasPrefix(session.Value, fmt.Sprint(version.Load())+".")
		switch r.URL.Path {
		case "/ticket":
			http.SetCookie(w, &http.Cookie{Name: "lms-session", Value: fmt.Sprintf("%d.%d", version.Load(), sessions.Add(1)), Path: "/", HttpOnly: true})
			http.Redirect(w, r, "/lms/homeHoml/doIndex", http.StatusFound)
		case "/lms/homeRedirect/", "/lms/homeHoml/doIndex":
			if !valid {
				http.Redirect(w, r, "/lms/error/notLogin", http.StatusFound)
				return
			}
			if r.URL.Path == "/lms/homeRedirect/" {
				http.Redirect(w, r, "/lms/homeHoml/doIndex", http.StatusFound)
				return
			}
			fmt.Fprint(w, `<span class="lms-search-condition-title">講義一覧</span><select name="nendo"><option value="2026" selected>2026</option></select><div class="lms-weekly-area"></div>`)
		case "/lms/error/notLogin":
			w.WriteHeader(http.StatusUnauthorized)
			fmt.Fprint(w, "Not logged in")
		case "/lms":
			fmt.Fprintf(w, `<p>統合認証アカウントでログインします</p><form action="%s"><button name="loginButton">Login</button></form>`, ssoURL)
		default:
			http.NotFound(w, r)
		}
	}))
	defer lms.Close()
	lmsURL.Store(lms.URL)
	root := t.TempDir()
	auth, err := adapter.New(adapter.Options{StateDir: filepath.Join(root, "auth"), ProfileDir: filepath.Join(root, "inbound"), CacheDir: filepath.Join(root, "auth-cache"), DownloadDir: filepath.Join(root, "auth-download"), Executable: executable, SSOURL: ssoURL, LMSURL: lms.URL, Parallelism: 1})
	if err != nil {
		t.Fatal(err)
	}
	defer auth.Close()
	lmsAuth := adapter.NewLMSAuthenticator(auth)
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	if err := lmsAuth.Login(ctx, false); err != nil {
		t.Fatal("inbound login", err)
	}
	work, err := adapter.New(adapter.Options{StateDir: filepath.Join(root, "work-state"), ProfileDir: filepath.Join(root, "outbound"), CacheDir: filepath.Join(root, "work-cache"), DownloadDir: filepath.Join(root, "work-download"), Executable: executable, SSOURL: ssoURL, LMSURL: lms.URL, Parallelism: 1})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { work.Close() }()
	if err := work.UseSSOCookies(lmsAuth); err != nil {
		t.Fatal(err)
	}
	if _, err := work.Courses(ctx); err != nil {
		t.Fatal("outbound login without a WebAuthn key", err)
	}
	if _, err := os.Stat(filepath.Join(root, "work-state", "webauthn.json")); !os.IsNotExist(err) {
		t.Fatal("work profile must not receive a WebAuthn credential", err)
	}
	if sessions.Load() != 2 {
		t.Fatal("work profile did not create its own session", sessions.Load())
	}
	// Both saved LMS and SSO sessions have expired. The inbound profile obtains
	// new SSO cookies; the outbound profile never acquires its WebAuthn key.
	version.Add(1)
	_, err = work.Courses(ctx)
	var authRequired *domain.Error
	if !errors.As(err, &authRequired) || authRequired.Reason != "authentication-required" {
		t.Fatalf("expired inbound session without registered WebAuthn must require login: %v", err)
	}
	grant.Store(true)
	if err := lmsAuth.Login(ctx, false); err != nil {
		t.Fatal("renew inbound SSO session", err)
	}
	if _, err := work.Courses(ctx); err != nil {
		t.Fatal("recovery after SSO expiry", err)
	}
	if sessions.Load() != 4 {
		t.Fatal("outbound did not create an independent renewed LMS session", sessions.Load())
	}
	if err := work.Close(); err != nil {
		t.Fatal(err)
	}
	work, err = adapter.New(adapter.Options{StateDir: filepath.Join(root, "work-state"), ProfileDir: filepath.Join(root, "outbound"), CacheDir: filepath.Join(root, "work-cache"), DownloadDir: filepath.Join(root, "work-download"), Executable: executable, SSOURL: ssoURL, LMSURL: lms.URL, Parallelism: 1})
	if err != nil {
		t.Fatal(err)
	}
	if err := work.UseSSOCookies(lmsAuth); err != nil {
		t.Fatal(err)
	}
	if _, err := work.Courses(ctx); err != nil {
		t.Fatal("restart with separate profile", err)
	}
}
