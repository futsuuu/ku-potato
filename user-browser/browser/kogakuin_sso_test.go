package browser

import (
	"bytes"
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"encoding/base64"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
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
	"github.com/chromedp/cdproto/webauthn"
	cd "github.com/chromedp/chromedp"
)

func TestSSORenewalCannotReuseUniversitySessions(t *testing.T) {
	var lmsURL atomic.Value
	var logins, bypasses atomic.Int32
	var pause, interactiveLogin atomic.Bool
	sso := httptest.NewServer(
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			switch r.URL.Path {
			case "/authenticate":
				logins.Add(1)
				http.SetCookie(
					w,
					&http.Cookie{Name: "sso", Value: "fresh", Path: "/", HttpOnly: true},
				)
				http.SetCookie(w, &http.Cookie{Name: "obsolete", Path: "/", MaxAge: -1})
				http.Redirect(w, r, lmsURL.Load().(string)+"/ticket", http.StatusFound)
			case "/u2flogin":
				if !pause.Load() {
					fmt.Fprint(
						w,
						`<script>setTimeout(() => location.assign('/authenticate'), 200)</script>`,
					)
				}
			default:
				if cookie, err := r.Cookie("sso"); err == nil && cookie.Value == "fresh" {
					http.Redirect(w, r, lmsURL.Load().(string)+"/ticket", http.StatusFound)
					return
				}
				fmt.Fprint(
					w,
					`<form action="/u2flogin"><input id="username_input" type="text"><button id="login_button">Login</button></form>`,
				)
				if interactiveLogin.Load() {
					fmt.Fprint(
						w,
						`<script>setTimeout(() => location.assign('/authenticate'), 200)</script>`,
					)
				}
			}
		}),
	)
	defer sso.Close()
	// Chrome resolves *.localhost to loopback. Keep cookie hosts distinct without
	// binding 127.0.0.2, which is not available by default on macOS.
	ssoURL := strings.Replace(sso.URL, "127.0.0.1", "sso.localhost", 1)
	gateway := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, err := r.Cookie("gateway"); err == nil {
			bypasses.Add(1)
			http.Redirect(w, r, lmsURL.Load().(string)+"/ticket", http.StatusFound)
		} else {
			http.Redirect(w, r, ssoURL, http.StatusFound)
		}
	}))
	defer gateway.Close()
	gatewayURL := strings.Replace(gateway.URL, "127.0.0.1", "gateway.localhost", 1)
	lms := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		home := func() { http.Redirect(w, r, "/lms/homeHoml/doIndex", http.StatusFound) }
		switch r.URL.Path {
		case "/ticket":
			http.SetCookie(w, &http.Cookie{Name: "lms", Value: "new", Path: "/"})
			home()
		case "/lms/homeRedirect/":
			if _, err := r.Cookie("lms"); err == nil {
				bypasses.Add(1)
				home()
			} else {
				http.Redirect(w, r, "/lms/error/notLogin", http.StatusFound)
			}
		case "/lms/error/notLogin":
			http.Error(w, "Not logged in", http.StatusUnauthorized)
		case "/lms":
			fmt.Fprintf(
				w,
				`<p>統合認証アカウントでログインします</p><form action="%s"><button name="loginButton">Login</button></form>`,
				gatewayURL,
			)
		case "/lms/homeHoml/doIndex":
			fmt.Fprint(
				w,
				`<span class="lms-search-condition-title">講義一覧</span><div class="lms-weekly-area"></div>`,
			)
		default:
			http.NotFound(w, r)
		}
	}))
	defer lms.Close()
	lmsURL.Store(lms.URL)
	root := t.TempDir()
	b, err := New(Options{
		StateDir: root, CacheDir: filepath.Join(root, "cache"), Executable: testChrome(t),
		LMSURL: lms.URL, SSOURL: ssoURL,
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = b.Close() })
	ctx, cancel := context.WithTimeout(t.Context(), time.Minute)
	defer cancel()
	// A real CDP authenticator exercises credential attachment and saving in
	// the isolated target; the local SSO fixture simulates its login result.
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	encoded, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Dir(b.credentialPath()), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := atomicJSON(b.credentialPath(), credentials{
		Version: 1, Username: "student",
		Credentials: []*webauthn.Credential{
			{
				CredentialID: "AQ==",
				PrivateKey:   base64.StdEncoding.EncodeToString(encoded),
				RpID:         "sso.localhost",
			},
		},
	}); err != nil {
		t.Fatal(err)
	}
	if err := b.start(ctx, false); err != nil {
		t.Fatal(err)
	}
	exec := cdp.WithExecutor(b.root, cd.FromContext(b.root).Browser)
	if err := storage.SetCookies([]*network.CookieParam{
		{Name: "sso", Value: "stale", Domain: "sso.localhost", Path: "/"},
		{Name: "obsolete", Value: "old", Domain: "sso.localhost", Path: "/"},
		{Name: "lms", Value: "retained", Domain: "127.0.0.1", Path: "/"},
		{Name: "gateway", Value: "retained", Domain: "gateway.localhost", Path: "/"},
		{Name: "google", Value: "retained", Domain: ".google.com", Path: "/"},
		{
			Name: "google-partitioned", Value: "retained", Domain: ".google.com", Path: "/",
			Secure: true, HTTPOnly: true, SameSite: network.CookieSameSiteNone,
			PartitionKey: &network.CookiePartitionKey{TopLevelSite: "https://example.test"},
		},
	}).Do(exec); err != nil {
		t.Fatal(err)
	}
	auth := NewKogakuinSSO(b)
	params, err := auth.RenewSSOCookies(ctx)
	if err != nil || len(params) != 1 || params[0].Name != "sso" || params[0].Value != "fresh" {
		t.Fatal("renewal did not produce a usable SSO-only session", params, err)
	}
	read := func() map[string]string {
		t.Helper()
		cookies, err := storage.GetCookies().
			Do(cdp.WithExecutor(b.root, cd.FromContext(b.root).Browser))
		if err != nil {
			t.Fatal(err)
		}
		values := map[string]string{}
		for _, cookie := range cookies {
			values[cookie.Name] = cookie.Value
			if cookie.Name == "google-partitioned" &&
				(cookie.Domain != ".google.com" || cookie.Path != "/" ||
					!reflect.DeepEqual(cookie.PartitionKey, &network.CookiePartitionKey{
						TopLevelSite: "https://example.test",
					})) {
				t.Fatalf(
					"Google cookie scope changed: %+v, partition key: %+v",
					cookie,
					cookie.PartitionKey,
				)
			}
		}
		return values
	}
	want := map[string]string{
		"sso":                "fresh",
		"lms":                "retained",
		"gateway":            "retained",
		"google":             "retained",
		"google-partitioned": "retained",
	}
	if got := read(); !reflect.DeepEqual(got, want) {
		t.Fatal("renewal modified provider sessions or retained obsolete SSO cookies", got)
	}
	if _, err := auth.SSOCookies(ctx); err != nil {
		t.Fatal(err)
	}
	if logins.Load() != 1 || bypasses.Load() != 0 {
		t.Fatal(
			"valid SSO was not reused, or university sessions bypassed SSO",
			logins.Load(),
			bypasses.Load(),
		)
	}
	if err := storage.SetCookies([]*network.CookieParam{
		{Name: "sso", Value: "revoked", Domain: "sso.localhost", Path: "/"},
	}).Do(exec); err != nil {
		t.Fatal(err)
	}
	want["sso"] = "revoked"
	pause.Store(true)
	short, stop := context.WithTimeout(ctx, time.Second)
	_, err = auth.RenewSSOCookies(short)
	stop()
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatal("renewal did not respect request cancellation", err)
	}
	pause.Store(false)
	if err := b.DeleteWebAuthn(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := auth.RenewSSOCookies(ctx); err == nil {
		t.Fatal("revoked SSO was accepted without a credential")
	} else if failure, ok := errors.AsType[*Error](err); !ok || failure.Reason != "authentication-required" {
		t.Fatal("unexpected renewal failure", err)
	}
	if ok, err := b.Status(ctx); err != nil || !ok {
		t.Fatal("fixture no longer has a valid LMS session", ok, err)
	}
	if ok, err := auth.Status(ctx); err != nil || ok {
		t.Fatal("LMS-only access was reported as transferable SSO authentication", ok, err)
	}
	if pages := authPageTargets(t, b.root); len(pages) != 0 {
		t.Fatal("SSO retained an ordinary provider page", len(pages))
	}
	if got := read(); !reflect.DeepEqual(got, want) {
		t.Fatal("failed renewal destroyed existing sessions", got)
	}
	contexts, _, err := target.GetBrowserContexts().
		Do(cdp.WithExecutor(b.root, cd.FromContext(b.root).Browser))
	if err != nil || len(contexts) != 0 {
		t.Fatal("renewal leaked an isolated browser context", contexts, err)
	}
	// Default to headless simulation, with opt-in headed coverage. Interactive
	// login must use SSO-only state and persist it before closing Chrome.
	interactiveLogin.Store(true)
	if err := b.stopRuntime(); err != nil {
		t.Fatal(err)
	}
	if err := b.start(ctx, os.Getenv("KU_POTATO_TEST_HEADED") == "1"); err != nil {
		t.Fatal(err)
	}
	b.interactive = true
	if err := auth.Login(ctx, true); err != nil {
		t.Fatal(err)
	}
	if b.root != nil || b.interactive {
		t.Fatal("interactive authentication browser was not closed")
	}
	if err := b.start(ctx, false); err != nil {
		t.Fatal(err)
	}
	if ok, err := auth.Status(ctx); err != nil || !ok {
		t.Fatal("valid SSO required an unnecessary saved credential", ok, err)
	}
	want["sso"] = "fresh"
	if got := read(); !reflect.DeepEqual(got, want) {
		t.Fatal("interactive login lost SSO or other provider sessions", got)
	}
}

type failingCookieCommitExecutor struct {
	cdp.Executor
	command    string
	failAt     int
	calls      int
	omitCookie bool
}

func (e *failingCookieCommitExecutor) Execute(
	ctx context.Context,
	method string,
	params, result any,
) error {
	if err := e.Executor.Execute(ctx, method, params, result); err != nil {
		return err
	}
	if method == e.command {
		e.calls++
		if e.calls == e.failAt {
			if e.omitCookie {
				result.(*storage.GetCookiesReturns).Cookies = nil
				return nil
			}
			// Chrome may apply a command before a timeout or disconnect is seen.
			return errors.New("interrupted cookie commit")
		}
	}
	return nil
}

func TestSSOCookieReplacementFailurePreservesCheckpoint(t *testing.T) {
	for _, test := range []struct {
		name       string
		command    string
		failAt     int
		omitCookie bool
	}{
		{"install", storage.CommandSetCookies, 1, false},
		{"verify", storage.CommandGetCookies, 2, false},
		{"missing-installed-cookie", storage.CommandGetCookies, 2, true},
		{"cleanup", storage.CommandSetCookies, 2, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			b, ctx := windowTestBrowser(t)
			b.interactive = false
			b.opts.SSOURL = "https://sso.example.test"
			if err := storage.SetCookies([]*network.CookieParam{
				{Name: "obsolete", Value: "old", Domain: "sso.example.test", Path: "/"},
			}).Do(cdp.WithExecutor(b.root, cd.FromContext(b.root).Browser)); err != nil {
				t.Fatal(err)
			}
			if saved, err := b.saveCookies(); err != nil || !saved {
				t.Fatal("fixture did not checkpoint cookies", saved, err)
			}
			before, err := os.ReadFile(b.cookiePath())
			if err != nil {
				t.Fatal(err)
			}
			auth := NewKogakuinSSO(b)
			fault := &failingCookieCommitExecutor{
				Executor:   cd.FromContext(b.root).Browser,
				command:    test.command,
				failAt:     test.failAt,
				omitCookie: test.omitCookie,
			}
			err = b.withProviderAuth(
				ctx,
				false,
				isolatedAuthPage,
				false,
				func(tab context.Context) error {
					return auth.replaceSSOCookies(
						cdp.WithExecutor(tab, fault),
						[]*network.CookieParam{
							{Name: "sso", Value: "new", Domain: "sso.example.test", Path: "/"},
						},
					)
				},
			)
			if err == nil || fault.calls != test.failAt || b.cookiesReady {
				t.Fatal(
					"failed commit was accepted or remained eligible for checkpointing",
					err,
					fault.calls,
				)
			}
			if err := b.stopRuntime(); err != nil {
				t.Fatal(err)
			}
			after, err := os.ReadFile(b.cookiePath())
			if err != nil || !bytes.Equal(before, after) {
				t.Fatal("failed SSO commit overwrote the last good checkpoint", err)
			}
			if err := b.start(ctx, false); err != nil {
				t.Fatal(err)
			}
			cookies, err := storage.GetCookies().
				Do(cdp.WithExecutor(b.root, cd.FromContext(b.root).Browser))
			if err != nil || len(cookies) != 3 {
				t.Fatal("retry lost the previous provider sessions", len(cookies), err)
			}
			for _, cookie := range cookies {
				want := "saved"
				if cookie.Name == "obsolete" {
					want = "old"
				}
				if cookie.Value != want {
					t.Fatal("retry restored a partially committed session", cookie.Name)
				}
			}
		})
	}
}

func TestSSOCookieReplacementPreservesRefreshedScopes(t *testing.T) {
	b, ctx := windowTestBrowser(t)
	b.opts.SSOURL = "https://sso.example.test"
	exec := cdp.WithExecutor(ctx, cd.FromContext(b.root).Browser)
	if err := storage.SetCookies([]*network.CookieParam{
		{Name: "sso", Value: "obsolete-path", Domain: "sso.example.test", Path: "/obsolete"},
		{
			Name:         "sso",
			Value:        "obsolete-partition",
			Domain:       "sso.example.test",
			Path:         "/",
			Secure:       true,
			PartitionKey: &network.CookiePartitionKey{TopLevelSite: "https://other.test"},
		},
	}).Do(exec); err != nil {
		t.Fatal(err)
	}
	params := []*network.CookieParam{
		{Name: "sso", Value: "refreshed", Domain: "sso.example.test", Path: "/"},
		{Name: "sso", Value: "refreshed-path", Domain: "sso.example.test", Path: "/login"},
		{Name: "sso", Value: "refreshed-parent", Domain: ".example.test", Path: "/"},
		{
			Name:         "sso",
			Value:        "refreshed-partition",
			Domain:       "sso.example.test",
			Path:         "/",
			Secure:       true,
			PartitionKey: &network.CookiePartitionKey{TopLevelSite: "https://example.test"},
		},
	}
	if err := NewKogakuinSSO(b).replaceSSOCookies(exec, params); err != nil {
		t.Fatal(err)
	}
	cookies, err := storage.GetCookies().Do(exec)
	if err != nil || len(cookies) != len(params)+1 {
		t.Fatal(
			"replacement lost a provider cookie or retained an obsolete scope",
			len(cookies),
			err,
		)
	}
	for _, cookie := range cookies {
		if cookie.Name == "persistent" && cookie.Value == "saved" {
			continue
		}
		actual := cookieParam(cookie)
		if actual == nil || !slices.ContainsFunc(params, func(param *network.CookieParam) bool {
			return sameCookieIdentity(actual, param) && actual.Value == param.Value
		}) {
			t.Fatal("cleanup retained an obsolete cookie or changed a refreshed scope", cookie.Name)
		}
	}
}

func TestCookieIdentityIncludesScope(t *testing.T) {
	base := network.CookieParam{
		Name: "sso", Domain: "sso.example.test", Path: "/",
		PartitionKey: &network.CookiePartitionKey{TopLevelSite: "https://example.test"},
	}
	for _, field := range []string{"value", "name", "domain", "path", "partition-site", "partition-ancestor", "unpartitioned"} {
		t.Run(field, func(t *testing.T) {
			other := base
			partition := *base.PartitionKey
			other.PartitionKey = &partition
			switch field {
			case "value":
				other.Value = "refreshed"
			case "name":
				other.Name = "other"
			case "domain":
				other.Domain = ".example.test"
			case "path":
				other.Path = "/login"
			case "partition-site":
				other.PartitionKey.TopLevelSite = "https://other.test"
			case "partition-ancestor":
				other.PartitionKey.HasCrossSiteAncestor = true
			case "unpartitioned":
				other.PartitionKey = nil
			}
			if sameCookieIdentity(&base, &other) != (field == "value") {
				t.Fatal("cookie identity did not distinguish its scope", field)
			}
		})
	}
}

func TestSSOCookieExportExcludesOtherSitesAndExpiredCookies(t *testing.T) {
	cookies := []*network.Cookie{
		{Name: "sso", Value: "current", Domain: "slink.secioss.com", Path: "/", Session: true},
		{Name: "parent", Value: "current", Domain: ".secioss.com", Path: "/", Session: true},
		{
			Name:    "expired",
			Value:   "old",
			Domain:  "slink.secioss.com",
			Path:    "/",
			Expires: float64(time.Now().Add(-time.Hour).Unix()),
		},
		{Name: "lms", Value: "secret", Domain: "study.ns.kogakuin.ac.jp", Path: "/", Session: true},
		{
			Name:    "gateway",
			Value:   "secret",
			Domain:  "study-auth.ns.kogakuin.ac.jp",
			Path:    "/",
			Session: true,
		},
		{Name: "empty-domain", Value: "secret", Domain: "", Path: "/", Session: true},
		{Name: "google", Value: "secret", Domain: ".google.com", Path: "/", Session: true},
		{
			Name:    "lookalike",
			Value:   "secret",
			Domain:  "slink.secioss.com.evil.test",
			Path:    "/",
			Session: true,
		},
	}
	params := ssoCookieParams("https://slink.secioss.com", cookies)
	if len(params) != 2 || params[0].Name != "sso" || params[1].Name != "parent" ||
		params[0].Expires != nil {
		t.Fatalf("SSO-only session cookie selection failed: %v", len(params))
	}
}
