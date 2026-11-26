package browser

import (
	"bytes"
	"context"
	"errors"
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
	"github.com/chromedp/cdproto/target"
	cd "github.com/chromedp/chromedp"
)

func googleOptions(t *testing.T) Options {
	t.Helper()
	root := t.TempDir()
	return Options{
		StateDir: filepath.Join(
			root,
			"state",
		),
		ProfileDir: filepath.Join(root, "state", "user-profile"),
		CacheDir:   filepath.Join(root, "cache"),
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

func TestProvidersShareCookiesAndGoogleClearingIsScoped(t *testing.T) {
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
		{
			Name:    "ku",
			Value:   "school",
			Domain:  "slink.secioss.com",
			Path:    "/",
			Expires: ptrExpiry(time.Now().Add(time.Hour)),
		},
		{
			Name:    "google",
			Value:   "account",
			Domain:  ".google.com",
			Path:    "/",
			Expires: ptrExpiry(time.Now().Add(time.Hour)),
		},
	}
	if err := storage.SetCookies(cookies).Do(exec); err != nil {
		t.Fatal(err)
	}
	if err := b.withProviderAuth(ctx, false, sharedAuthPage, false, g.clearCookies); err != nil {
		t.Fatal(err)
	}
	all, err := storage.GetCookies().Do(exec)
	if err != nil || len(all) != 1 || all[0].Name != "ku" {
		t.Fatal("Google login cleared school session", all, err)
	}
	if err := b.stopRuntime(); err != nil {
		t.Fatal(err)
	}
	if err := b.start(ctx, false); err != nil {
		t.Fatal(err)
	}
	exec = cdp.WithExecutor(b.root, cd.FromContext(b.root).Browser)
	all, err = storage.GetCookies().Do(exec)
	if err != nil || len(all) != 1 || all[0].Name != "ku" {
		t.Fatal("cookie snapshot did not persist school session", all, err)
	}
}

func ptrExpiry(value time.Time) *cdp.TimeSinceEpoch {
	expiry := cdp.TimeSinceEpoch(value)
	return &expiry
}

func TestClosingWindowInterruptsGoogleLogin(t *testing.T) {
	waiting := make(chan struct{}, 1)
	var authenticated atomic.Bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/waiting" {
			select {
			case waiting <- struct{}{}:
			default:
			}
			w.WriteHeader(http.StatusNoContent)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		if authenticated.Load() {
			fmt.Fprint(w, googleProfile("student@g.kogakuin.jp"))
			return
		}
		// Signal from the account query inside Google's actual login poll,
		// rather than merely from navigation or a provider test callback.
		fmt.Fprint(w, `<input id="identifierId"><script>
			const queryAll = document.querySelectorAll;
			document.querySelectorAll = function(...args) {
				fetch('/waiting').catch(() => {});
				return queryAll.apply(this, args);
			};
		</script>`)
	}))
	defer server.Close()
	b, ctx := windowTestBrowser(t)
	g := NewGoogle(b)
	g.origin, g.signin = server.URL, server.URL+"/identifier"
	before, err := os.ReadFile(b.cookiePath())
	if err != nil {
		t.Fatal(err)
	}
	root := b.root
	exec := cdp.WithExecutor(root, cd.FromContext(root).Browser)
	request, cancelRequest := context.WithCancel(ctx)
	finished := make(chan struct{})
	result := make(chan error, 1)
	go func() {
		defer close(finished)
		result <- g.Login(request, true)
	}()
	defer func() {
		// Only failure cleanup cancels a still-running request. A passing test
		// must finish the login solely because its target was closed.
		cancelRequest()
		<-finished
	}()
	select {
	case <-waiting:
	case err := <-result:
		t.Fatal("login finished before waiting for user input", err)
	case <-time.After(10 * time.Second):
		t.Fatal("login did not enter its account poll")
	}
	closed := make(chan error, 1)
	go func() {
		targets, err := target.GetTargets().Do(exec)
		if err != nil {
			closed <- err
			return
		}
		var id target.ID
		for _, info := range targets {
			if info.Type == "page" {
				if id != "" {
					closed <- errors.New("login created more than one page")
					return
				}
				id = info.TargetID
			}
		}
		if id == "" {
			closed <- errors.New("login has no page")
			return
		}
		closed <- target.CloseTarget(id).Do(exec)
	}()
	select {
	case err := <-closed:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("login window could not be closed")
	}
	select {
	case err := <-result:
		if !errors.Is(err, context.Canceled) {
			t.Fatal("window closure was not reported as cancellation", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("closing the window did not interrupt the login poll")
	}
	if request.Err() != nil {
		t.Fatal("fixture cancelled the request instead of just closing the window")
	}
	after, err := os.ReadFile(b.cookiePath())
	if err != nil || !bytes.Equal(after, before) {
		t.Fatal("interrupted login overwrote saved provider sessions", err)
	}
	// A different provider must be able to acquire authMu and restore cookies.
	if err := b.withSessionAuth(request, false, false, func(tab context.Context) error {
		return cd.Run(tab, cd.Evaluate("1 + 1", nil))
	}); err != nil {
		t.Fatal("closed login blocked another provider", err)
	}
	cookies, err := b.loadCookies()
	if err != nil || len(cookies) != 2 || cookies[0].Value != "saved" ||
		cookies[1].Value != "saved" {
		t.Fatal("another provider did not restore its saved sessions", err)
	}
	authenticated.Store(true)
	if os.Getenv("KU_POTATO_TEST_HEADED") == "1" {
		if err := g.Login(request, true); err != nil {
			t.Fatal("interactive login could not be retried", err)
		}
	} else if ok, err := g.Status(request); err != nil || !ok {
		t.Fatal("authentication could not be retried", ok, err)
	}
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
			fmt.Fprint(
				w,
				`<form action="/authenticate"><input id="identifierId" name="email" type="email"><button>Next</button></form>`,
			)
			return
		}
		if r.URL.Path == "/authenticate" {
			if r.URL.Query().Get("email") != "student@g.kogakuin.jp" {
				http.Error(w, "wrong account", http.StatusUnauthorized)
				return
			}
			http.SetCookie(
				w,
				&http.Cookie{
					Name:     "session",
					Value:    "signed-in",
					Path:     "/",
					HttpOnly: true,
					Expires:  time.Now().Add(24 * time.Hour),
				},
			)
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
	var driveAccount atomic.Value
	driveAccount.Store("student@g.kogakuin.jp")
	var initialized atomic.Int32
	drive := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		if driveAccount.Load().(string) == "" {
			http.Redirect(w, r, server.URL+"/signin", http.StatusFound)
			return
		}
		if r.URL.Path == "/initialize-drive" {
			initialized.Add(1)
			http.SetCookie(w, &http.Cookie{
				Name: "drive_session", Value: "ready", Path: "/", HttpOnly: true,
				Expires: time.Now().Add(24 * time.Hour),
			})
			http.Redirect(w, r, "/drive/u/0/home", http.StatusFound)
			return
		}
		if _, err := r.Cookie("drive_session"); err != nil {
			// This document has the final URL and reaches readyState=complete,
			// but the service session is not usable until the delayed redirect.
			fmt.Fprint(
				w,
				`<script>setTimeout(() => location.assign('/initialize-drive'), 300)</script>`,
			)
			return
		}
		fmt.Fprint(w, driveProfile(driveAccount.Load().(string)))
	}))
	defer drive.Close()
	opts := googleOptions(t)
	opts.Executable = executable
	g := newGoogle(t, opts)
	g.origin = server.URL
	g.driveOrigin = drive.URL
	g.signin = server.URL + "/identifier"
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	if err := os.MkdirAll(filepath.Dir(g.browser.credentialPath()), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(g.browser.credentialPath(), []byte("invalid"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := g.browser.start(ctx, os.Getenv("KU_POTATO_TEST_HEADED") == "1"); err != nil {
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
	loginPage := g.browser.page
	if err := cd.Run(
		loginPage,
		cd.WaitVisible("#identifierId", cd.ByQuery),
		cd.SetValue("#identifierId", "student@g.kogakuin.jp", cd.ByQuery),
	); err != nil {
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
	opts.ProfileDir = filepath.Join(opts.StateDir, "fresh-profile")
	g = newGoogle(t, opts)
	g.origin = server.URL
	g.driveOrigin = drive.URL
	if ok, err := g.Status(ctx); err != nil || !ok {
		t.Fatal("session lost after restart", ok, err)
	}
	t.Log("session restored independently of the browser profile")
	cookies, err := g.Cookies(ctx)
	if err != nil {
		t.Fatal(err)
	}
	parsed, _ := url.Parse(server.URL)
	names := []string{}
	for _, cookie := range cookies {
		names = append(names, cookie.Name)
	}
	slices.Sort(names)
	if !reflect.DeepEqual(names, []string{"drive_session", "session"}) || initialized.Load() != 1 {
		t.Fatal("Drive cookies exported before service login completed", names, initialized.Load())
	}
	if _, err := os.Stat(g.browser.cookiePath()); err != nil {
		t.Fatal("shared cookie snapshot was not written", err)
	}
	exec := cdp.WithExecutor(g.browser.root, cd.FromContext(g.browser.root).Browser)
	for _, value := range []string{"first", "rotated"} {
		if err := storage.SetCookies([]*network.CookieParam{{Name: "rotating", Value: value, Domain: parsed.Hostname(), Path: "/", Expires: ptrExpiry(time.Now().Add(time.Hour))}}).
			Do(exec); err != nil {
			t.Fatal(err)
		}
		fresh, err := g.Cookies(ctx)
		if err != nil {
			t.Fatal(err)
		}
		found := false
		for _, cookie := range fresh {
			if cookie.Name == "rotating" {
				found = cookie.Value == value
			}
		}
		if !found {
			t.Fatal("Cookies did not read the current profile cookie")
		}
	}
	if initialized.Load() != 1 {
		t.Fatal("Drive service session was not reused")
	}
	for _, email := range []string{"student@gmail.com", ""} {
		driveAccount.Store(email)
		_, err := g.Cookies(ctx)
		if failure, ok := errors.AsType[*Error](
			err,
		); !ok ||
			failure.Reason != "authentication-required" {
			t.Fatal("invalid Drive account was not classified as authentication-required", err)
		}
	}
}

func googleProfile(email string) string {
	return `<a role="button" aria-label="Google Account: Student (` +
		html.EscapeString(email) +
		`)" href="https://accounts.google.com/SignOutOptions?authuser=0">Account</a>`
}

func driveProfile(email string) string {
	return `<a role="button" aria-label="Google アカウント: Student (` +
		html.EscapeString(email) + `)">Account</a>`
}

func TestDriveAccountControlWithoutHref(t *testing.T) {
	var response atomic.Value
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		fmt.Fprint(w, response.Load().(string))
	}))
	defer server.Close()
	opts := googleOptions(t)
	opts.Executable = testChrome(t)
	g := newGoogle(t, opts)
	g.driveOrigin = server.URL
	ctx, cancel := context.WithTimeout(t.Context(), time.Minute)
	defer cancel()
	for _, test := range []struct {
		name, body, email string
	}{
		{"japanese", driveProfile("student@g.kogakuin.jp"), "student@g.kogakuin.jp"},
		{"english", strings.Replace(driveProfile("student@g.kogakuin.jp"), "Google アカウント", "Google Account", 1), "student@g.kogakuin.jp"},
		{"personal", driveProfile("student@gmail.com"), "student@gmail.com"},
		{"hidden", `<div hidden>` + driveProfile("student@g.kogakuin.jp") + `</div>`, ""},
		{"unrelated button", `<a role="button" aria-label="Open student@g.kogakuin.jp">File</a>`, ""},
		{"remembered account", `<div aria-label="Google アカウント: student@g.kogakuin.jp">Remembered</div>`, ""},
		{"untrusted link", strings.Replace(googleProfile("student@g.kogakuin.jp"), "https://accounts.google.com", "https://accounts.google.com.evil.test", 1), ""},
		{"missing email", driveProfile("Student"), ""},
		{"ambiguous email", driveProfile("first@g.kogakuin.jp second@g.kogakuin.jp"), ""},
	} {
		t.Run(test.name, func(t *testing.T) {
			response.Store(test.body)
			var email string
			err := g.browser.withProviderAuth(
				ctx,
				false,
				sharedAuthPage,
				false,
				func(tab context.Context) error {
					return cd.Run(
						tab,
						cd.Navigate(server.URL),
						cd.Evaluate(g.accountExpression(g.driveOrigin), &email),
					)
				},
			)
			if err != nil || email != test.email {
				t.Fatal("incorrect Drive account control detection", email, err)
			}
		})
	}
}

func TestGoogleRequiresActiveUniversityAccount(t *testing.T) {
	executable := testChrome(t)
	var response atomic.Value
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/favicon.ico" {
			http.NotFound(w, r)
			return
		}
		if r.URL.Path != "/" || r.URL.Query().Get("hl") != "en" ||
			r.URL.Query().Get("authuser") != "0" {
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
	if _, err := g.Cookies(ctx); err == nil {
		t.Fatal("Cookies accepted a personal account")
	}
}

func TestGoogleExportsOnlyUsableSessionCookies(t *testing.T) {
	g := newGoogle(t, googleOptions(t))
	if _, err := g.cookieParams(nil); err == nil {
		t.Fatal("empty session accepted")
	}
	expires := float64(time.Now().Add(-time.Hour).Unix())
	cookies := []*network.Cookie{
		{
			Name:    "shared",
			Value:   "test",
			Domain:  ".google.com",
			Path:    "/",
			Secure:  true,
			Session: true,
		},
		{
			Name:    "host",
			Value:   "test",
			Domain:  "drive.google.com",
			Path:    "/",
			Secure:  true,
			Session: true,
		},
		{Name: "path", Value: "test", Domain: "drive.google.com", Path: "/download", Session: true},
		{Name: "expired", Value: "test", Domain: ".google.com", Path: "/", Expires: expires},
		{
			Name:         "partitioned",
			Value:        "test",
			Domain:       ".google.com",
			Path:         "/",
			Session:      true,
			PartitionKey: &network.CookiePartitionKey{TopLevelSite: "https://google.com"},
		},
		{
			Name:    "usercontent",
			Value:   "test",
			Domain:  "drive.usercontent.google.com",
			Path:    "/",
			Secure:  true,
			Session: true,
		},
		{Name: "school", Value: "test", Domain: "slink.secioss.com", Path: "/", Session: true},
	}
	params, err := g.cookieParams(cookies)
	if err != nil {
		t.Fatal(err)
	}
	names := []string{}
	for _, cookie := range params {
		names = append(names, cookie.Name)
	}
	slices.Sort(names)
	if !reflect.DeepEqual(names, []string{"host", "path", "shared", "usercontent"}) {
		t.Fatal("export included a school, expired, or partitioned cookie", names)
	}
	for _, cookie := range params {
		if cookie.Name == "host" && cookie.Domain != "drive.google.com" {
			t.Fatal("host-only scope lost", cookie)
		}
		if cookie.Name == "path" && cookie.Path != "/download" {
			t.Fatal("path scope lost", cookie)
		}
		if cookie.Name == "shared" && (!cookie.Secure || cookie.Domain != ".google.com") {
			t.Fatal("domain scope lost", cookie)
		}
	}
}
