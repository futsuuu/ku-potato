package browserauth

import (
	"context"
	"fmt"
	"html"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"reflect"
	"slices"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/chromedp/cdproto/cdp"
	"github.com/chromedp/cdproto/network"
	"github.com/chromedp/cdproto/storage"
	cd "github.com/chromedp/chromedp"
)

func googleOptions(t *testing.T) Options {
	t.Helper()
	root := t.TempDir()
	return Options{
		StateDir: filepath.Join(root, "state"), ProfileDir: filepath.Join(root, "state", "user-profile"),
		CacheDir: filepath.Join(root, "cache"),
	}
}

func newGoogle(t *testing.T, opts Options) *Google {
	t.Helper()
	b, err := New(opts)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = b.Close() })
	return NewGoogle(b)
}

func TestProvidersSharePersistentProfileAndGoogleClearingIsScoped(t *testing.T) {
	opts := googleOptions(t)
	opts.Executable = testChrome(t)
	g := newGoogle(t, opts)
	b := g.browser
	defer func() { _ = b.Close(); time.Sleep(500 * time.Millisecond) }()
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	if err := b.start(ctx, false); err != nil {
		t.Fatal(err)
	}
	exec := cdp.WithExecutor(b.root, cd.FromContext(b.root).Browser)
	cookies := []*network.CookieParam{
		{Name: "ku", Value: "school", Domain: "slink.secioss.com", Path: "/", Expires: ptrExpiry(time.Now().Add(time.Hour))},
		{Name: "google", Value: "account", Domain: ".google.com", Path: "/", Expires: ptrExpiry(time.Now().Add(time.Hour))},
	}
	if err := storage.SetCookies(cookies).Do(exec); err != nil {
		t.Fatal(err)
	}
	if err := cd.Run(b.root, cd.ActionFunc(g.clearCookies)); err != nil {
		t.Fatal(err)
	}
	all, err := storage.GetCookies().Do(exec)
	if err != nil || len(all) != 1 || all[0].Name != "ku" {
		t.Fatal("Google login cleared school session", all, err)
	}
	b.stopRuntime()
	if err := b.start(ctx, false); err != nil {
		t.Fatal(err)
	}
	exec = cdp.WithExecutor(b.root, cd.FromContext(b.root).Browser)
	all, err = storage.GetCookies().Do(exec)
	if err != nil || len(all) != 1 || all[0].Name != "ku" {
		t.Fatal("shared profile did not persist school session", all, err)
	}
}

func ptrExpiry(value time.Time) *cdp.TimeSinceEpoch {
	expiry := cdp.TimeSinceEpoch(value)
	return &expiry
}

func TestGoogleSessionSurvivesRestartWithoutWebAuthn(t *testing.T) {
	executable := testChrome(t)
	identifierOpened := make(chan struct{}, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		if r.URL.Path == "/identifier" {
			select {
			case identifierOpened <- struct{}{}:
			default:
			}
			if _, err := r.Cookie("session"); err == nil {
				t.Error("saved session bypassed the identifier screen")
			}
			if r.URL.Query().Get("continue") == "" {
				t.Error("login has no return destination")
			}
			fmt.Fprint(w, `<form action="/authenticate"><input id="identifierId" name="email" type="email"><button>Next</button></form>`)
			return
		}
		if r.URL.Path == "/authenticate" {
			if r.URL.Query().Get("email") != "student@g.kogakuin.jp" {
				http.Error(w, "wrong account", http.StatusUnauthorized)
				return
			}
			http.SetCookie(w, &http.Cookie{Name: "session", Value: "signed-in", Path: "/", HttpOnly: true, Expires: time.Now().Add(24 * time.Hour)})
			http.Redirect(w, r, "/?hl=en&authuser=0", http.StatusFound)
			return
		}
		if r.URL.Path == "/signin" {
			fmt.Fprint(w, `<input id="identifierId" type="email">`)
			return
		}
		if cookie, err := r.Cookie("session"); err != nil || cookie.Value != "signed-in" {
			http.Redirect(w, r, "/signin", http.StatusFound)
			return
		}
		fmt.Fprint(w, googleProfile("student@g.kogakuin.jp"))
	}))
	defer server.Close()
	opts := googleOptions(t)
	opts.Executable = executable
	g := newGoogle(t, opts)
	g.origin = server.URL
	g.signin = server.URL + "/identifier"
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	if err := os.MkdirAll(filepath.Dir(g.browser.credentialPath()), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(g.browser.credentialPath(), []byte("invalid"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := g.browser.start(ctx, false); err != nil {
		t.Fatal(err)
	}
	g.browser.interactive = true
	loginRoot := g.browser.root
	loginDone := make(chan error, 1)
	go func() { loginDone <- g.Login(ctx, true) }()
	select {
	case <-identifierOpened:
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	loginPage := g.browser.root
	if err := cd.Run(loginPage, cd.WaitVisible("#identifierId", cd.ByQuery), cd.SetValue("#identifierId", "student@g.kogakuin.jp", cd.ByQuery)); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-loginDone:
		t.Fatal("login completed before the account was submitted", err)
	default:
	}
	if err := cd.Run(loginPage, cd.Click("button", cd.ByQuery)); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-loginDone:
		if err != nil {
			t.Fatal(err)
		}
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	t.Log("interactive session saved")
	if g.browser.root != nil || g.browser.interactive || loginRoot.Err() == nil {
		t.Fatal("interactive browser was not closed")
	}
	if ok, err := g.Status(ctx); err != nil || !ok {
		t.Fatal("session lost after login", ok, err)
	}
	t.Log("headless session restored")
	if err := g.browser.Close(); err != nil {
		t.Fatal(err)
	}
	g = newGoogle(t, opts)
	g.origin = server.URL
	if ok, err := g.Status(ctx); err != nil || !ok {
		t.Fatal("session lost after restart", ok, err)
	}
	t.Log("session restored from the browser profile")
	jar, err := g.CookieJar(ctx)
	if err != nil {
		t.Fatal(err)
	}
	parsed, _ := url.Parse(server.URL)
	if cookies := jar.Cookies(parsed); len(cookies) != 1 || cookies[0].Name != "session" {
		t.Fatal("HTTP session was not restored")
	}
	snapshotPath := filepath.Join(opts.StateDir, "auth", "google", "cookies.json")
	if _, err := os.Stat(snapshotPath); !os.IsNotExist(err) {
		t.Fatal("Google cookie snapshot was written", err)
	}
	exec := cdp.WithExecutor(g.browser.root, cd.FromContext(g.browser.root).Browser)
	for _, value := range []string{"first", "rotated"} {
		if err := storage.SetCookies([]*network.CookieParam{{Name: "rotating", Value: value, Domain: parsed.Hostname(), Path: "/", Expires: ptrExpiry(time.Now().Add(time.Hour))}}).Do(exec); err != nil {
			t.Fatal(err)
		}
		fresh, err := g.CookieJar(ctx)
		if err != nil {
			t.Fatal(err)
		}
		found := false
		for _, cookie := range fresh.Cookies(parsed) {
			if cookie.Name == "rotating" {
				found = cookie.Value == value
			}
		}
		if !found {
			t.Fatal("CookieJar did not read the current profile cookie")
		}
	}
	if _, err := os.Stat(snapshotPath); !os.IsNotExist(err) {
		t.Fatal("Google cookie snapshot was written", err)
	}
}

func googleProfile(email string) string {
	return `<a role="button" aria-label="Google Account: Student (` + html.EscapeString(email) + `)" href="https://accounts.google.com/SignOutOptions?authuser=0">Account</a>`
}

func TestGoogleRequiresActiveUniversityAccount(t *testing.T) {
	executable := testChrome(t)
	var response atomic.Value
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/favicon.ico" {
			http.NotFound(w, r)
			return
		}
		if r.URL.Path != "/" || r.URL.Query().Get("hl") != "en" || r.URL.Query().Get("authuser") != "0" {
			t.Errorf("unexpected authentication destination: %s", r.URL)
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		fmt.Fprint(w, response.Load().(string))
	}))
	defer server.Close()
	opts := googleOptions(t)
	opts.Executable = executable
	g := newGoogle(t, opts)
	g.origin = server.URL
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	for _, test := range []struct {
		name, body    string
		authenticated bool
	}{
		{"university", googleProfile("student@g.kogakuin.jp"), true},
		{"uppercase", googleProfile("STUDENT@G.KOGAKUIN.JP"), true},
		{"personal", googleProfile("student@gmail.com"), false},
		{"subdomain", googleProfile("student@other.g.kogakuin.jp"), false},
		{"suffix", googleProfile("student@g.kogakuin.jp.evil.test"), false},
		{"remembered", googleProfile("student@gmail.com") + `<div data-identifier="student@g.kogakuin.jp">student@g.kogakuin.jp</div>`, false},
		{"signed-out", `<input id="identifierId"><p>student@g.kogakuin.jp</p>`, false},
		{"sign-in-link-on-active-page", googleProfile("student@g.kogakuin.jp") + `<a href="https://accounts.google.com/ServiceLogin">Sign in</a>`, true},
		{"hidden-profile", `<div hidden>` + googleProfile("student@g.kogakuin.jp") + `</div>` + googleProfile("student@gmail.com"), false},
		{"untrusted-profile", strings.ReplaceAll(googleProfile("student@g.kogakuin.jp"), "https://accounts.google.com", "https://accounts.google.com.evil.test") + googleProfile("student@gmail.com"), false},
	} {
		t.Run(test.name, func(t *testing.T) {
			response.Store(test.body)
			ok, err := g.Status(ctx)
			if err != nil || ok != test.authenticated {
				t.Fatal("wrong account status", ok, err)
			}
		})
	}
	response.Store(googleProfile("student@gmail.com"))
	if _, err := g.CookieJar(ctx); err == nil {
		t.Fatal("CookieJar accepted a personal account")
	}
}

func TestGoogleCookieJarPreservesCookieScope(t *testing.T) {
	g := newGoogle(t, googleOptions(t))
	if _, err := g.cookieJar(nil); err == nil {
		t.Fatal("empty session accepted")
	}
	expires := float64(time.Now().Add(-time.Hour).Unix())
	cookies := []*network.Cookie{
		{Name: "shared", Value: "test", Domain: ".google.com", Path: "/", Secure: true, Session: true},
		{Name: "host", Value: "test", Domain: "drive.google.com", Path: "/", Secure: true, Session: true},
		{Name: "path", Value: "test", Domain: "drive.google.com", Path: "/download", Session: true},
		{Name: "expired", Value: "test", Domain: ".google.com", Path: "/", Expires: expires},
		{Name: "partitioned", Value: "test", Domain: ".google.com", Path: "/", Session: true, PartitionKey: &network.CookiePartitionKey{TopLevelSite: "https://google.com"}},
		{Name: "usercontent", Value: "test", Domain: "drive.usercontent.google.com", Path: "/", Secure: true, Session: true},
		{Name: "school", Value: "test", Domain: "slink.secioss.com", Path: "/", Session: true},
	}
	jar, err := g.cookieJar(cookies)
	if err != nil {
		t.Fatal(err)
	}
	for address, expected := range map[string][]string{
		"https://drive.google.com/":                     {"host", "shared"},
		"https://drive.google.com/download/file":        {"host", "path", "shared"},
		"https://sub.drive.google.com/":                 {"shared"},
		"https://drive.usercontent.google.com/download": {"shared", "usercontent"},
		"http://drive.google.com/":                      {},
		"https://google.com.evil.test/":                 {},
		"https://slink.secioss.com/":                    {},
		"https://example.com/":                          {},
	} {
		parsed, _ := url.Parse(address)
		names := []string{}
		for _, cookie := range jar.Cookies(parsed) {
			names = append(names, cookie.Name)
		}
		slices.Sort(names)
		if !reflect.DeepEqual(names, expected) {
			t.Fatal(address, names, expected)
		}
	}
}
