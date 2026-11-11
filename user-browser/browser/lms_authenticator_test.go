package browser

import (
	"testing"
	"time"

	"github.com/chromedp/cdproto/network"
)

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
