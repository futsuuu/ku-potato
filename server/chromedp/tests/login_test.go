package tests

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	adapter "github.com/futsuuu/ku-potato/server/chromedp"
	"github.com/futsuuu/ku-potato/server/domain"
)

func TestInitialUnauthenticatedHomeRedirect(t *testing.T) {
	executable := chrome(t)
	portal := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, "<p>Authentication required</p>")
	}))
	defer portal.Close()
	var loginVisits atomic.Int32
	lms := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		switch r.URL.Path {
		case "/lms/homeRedirect/":
			http.Redirect(w, r, "/lms/error/notLogin;SID=fixture", http.StatusFound)
		case "/lms/error/notLogin;SID=fixture":
			w.WriteHeader(http.StatusUnauthorized)
			fmt.Fprint(w, "<p>Not logged in</p>")
		case "/lms":
			loginVisits.Add(1)
			fmt.Fprintf(w, `<p>統合認証アカウントでログインします</p><form action="%s/pub/login.cgi"><button name="loginButton">Login</button></form>`, portal.URL)
		default:
			http.NotFound(w, r)
		}
	}))
	defer lms.Close()
	dir := t.TempDir()
	browser, err := adapter.New(adapter.Options{StateDir: filepath.Join(dir, "state"), CacheDir: filepath.Join(dir, "cache"), DownloadDir: filepath.Join(dir, "downloads"), Executable: executable, LMSURL: lms.URL, PortalURL: portal.URL})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { browser.Close() })
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	ok, err := browser.Status(ctx)
	if err != nil || ok {
		t.Fatal("initial authentication check should report unauthenticated", ok, err)
	}
	for _, check := range []struct {
		name string
		run  func(context.Context) error
	}{
		{"login", func(ctx context.Context) error { return browser.Login(ctx, false) }},
		{"courses", func(ctx context.Context) error { _, err := browser.Courses(ctx); return err }},
	} {
		err := check.run(ctx)
		var failure *domain.Error
		if !errors.As(err, &failure) || failure.Reason != "authentication-required" {
			t.Fatal(check.name, "should require authentication instead of timing out", err)
		}
	}
	if loginVisits.Load() != 3 {
		t.Fatal("authentication did not open the login page", loginVisits.Load())
	}
}
