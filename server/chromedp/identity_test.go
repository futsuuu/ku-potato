package chromedp

import (
	"context"
	"net/http"
	"net/http/cookiejar"
	"path/filepath"
	"testing"
	"time"

	"github.com/chromedp/cdproto/network"
)

func TestSSOCookieExportExcludesOtherSitesAndExpiredCookies(t *testing.T) {
	cookies := []*network.Cookie{
		{Name: "sso", Value: "current", Domain: "slink.secioss.com", Path: "/", Session: true},
		{Name: "parent", Value: "current", Domain: ".secioss.com", Path: "/", Session: true},
		{Name: "expired", Value: "old", Domain: "slink.secioss.com", Path: "/", Expires: float64(time.Now().Add(-time.Hour).Unix())},
		{Name: "lms", Value: "secret", Domain: "study.ns.kogakuin.ac.jp", Path: "/", Session: true},
		{Name: "google", Value: "secret", Domain: ".google.com", Path: "/", Session: true},
		{Name: "lookalike", Value: "secret", Domain: "slink.secioss.com.evil.test", Path: "/", Session: true},
	}
	params := ssoCookieParams("https://slink.secioss.com", cookies)
	if len(params) != 2 || params[0].Name != "sso" || params[1].Name != "parent" || params[0].Expires != nil {
		t.Fatalf("SSO-only session cookie selection failed: %v", len(params))
	}
}

func TestSSOCookieBridgeRequiresSeparateProfiles(t *testing.T) {
	root := t.TempDir()
	opts := Options{StateDir: filepath.Join(root, "state"), CacheDir: filepath.Join(root, "cache"), DownloadDir: filepath.Join(root, "downloads")}
	one, err := New(opts)
	if err != nil {
		t.Fatal(err)
	}
	defer one.Close()
	two, err := New(opts)
	if err != nil {
		t.Fatal(err)
	}
	defer two.Close()
	if err := two.UseSSOCookies(NewIdentity(one)); err == nil {
		t.Fatal("shared browser profile accepted")
	}
	two.opts.ProfileDir = filepath.Join(root, "independent")
	if err := two.UseSSOCookies(NewIdentity(one)); err != nil {
		t.Fatal("separate browser profiles rejected", err)
	}
}

type driveCookieStub struct{ called bool }

func (s *driveCookieStub) CookieJar(context.Context) (http.CookieJar, error) {
	s.called = true
	return cookiejar.New(nil)
}

func TestDriveClientUsesOnlyInjectedCookieSource(t *testing.T) {
	browser, err := New(Options{StateDir: t.TempDir(), CacheDir: t.TempDir(), DownloadDir: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	defer browser.Close()
	cookies := &driveCookieStub{}
	browser.UseDriveCookies(cookies)
	d, err := browser.drive.driveClient(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	d.client.CloseIdleConnections()
	if !cookies.called || browser.root != nil {
		t.Fatal("Drive started a work browser instead of requesting authentication cookies")
	}
}
