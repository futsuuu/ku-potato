package chromedp

import (
	"context"
	"errors"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"strings"
	"time"

	"github.com/chromedp/cdproto/cdp"
	"github.com/chromedp/cdproto/network"
	"github.com/chromedp/cdproto/storage"
	cd "github.com/chromedp/chromedp"
	"github.com/futsuuu/ku-potato/server/core/outport"
	"github.com/futsuuu/ku-potato/server/domain"
	"golang.org/x/net/publicsuffix"
)

type Google struct {
	browser *Browser
	origin  string
	signin  string
}

var _ outport.Authentication = (*Google)(nil)

func NewGoogle(browser *Browser) *Google {
	g := &Google{browser: browser, origin: "https://myaccount.google.com", signin: "https://accounts.google.com/v3/signin/identifier"}
	browser.google = g
	return g
}

func (g *Google) accountExpression() string {
	// Read the active profile control, never remembered accounts or page text.
	return `(()=>{if(document.readyState==='loading'||location.origin!==` + js(g.origin) + `)return '';for(const a of document.querySelectorAll('a[role="button"][aria-label][href]')){const u=new URL(a.href);if(u.origin!=='https://accounts.google.com'||u.pathname!=='/SignOutOptions'||!a.getClientRects().length)continue;const emails=a.getAttribute('aria-label').match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi)||[];if(emails.length===1)return emails[0].toLowerCase()}return ''})()`
}

func (g *Google) signedOutExpression() string {
	return `document.readyState==='complete' && ((location.origin==='https://www.google.com'&&location.pathname==='/account/about/')||(location.origin==='https://accounts.google.com'&&/^\/(?:ServiceLogin|(?:v\d+\/)?signin(?:\/|$))/.test(location.pathname))||(location.origin===` + js(g.origin) + `&&!!document.querySelector('#identifierId')))`
}

func (g *Google) loginURL() string {
	query := url.Values{
		"continue":  {g.origin + "/?hl=en&authuser=0"},
		"service":   {"accountsettings"},
		"flowName":  {"GlifWebSignIn"},
		"flowEntry": {"ServiceLogin"},
		"hl":        {"ja"},
	}
	return g.signin + "?" + query.Encode()
}

func (g *Google) Login(ctx context.Context, interactive bool) error {
	return g.browser.withProviderAuth(ctx, interactive, false, true, func(tab context.Context) error {
		return g.verify(tab, interactive)
	})
}

func (g *Google) verify(tab context.Context, interactive bool) error {
	destination := g.origin + "/?hl=en&authuser=0"
	if interactive {
		if err := g.clearCookies(tab); err != nil {
			return err
		}
		destination = g.loginURL()
	}
	if err := cd.Run(tab, cd.Navigate(destination)); err != nil {
		return err
	}
	if interactive {
		return poll(tab, `(`+g.accountExpression()+`).endsWith('@g.kogakuin.jp')`)
	}
	if err := poll(tab, `!!(`+g.accountExpression()+`) || (`+g.signedOutExpression()+`)`); err != nil {
		return err
	}
	var email string
	if err := cd.Run(tab, cd.Evaluate(g.accountExpression(), &email)); err != nil {
		return err
	}
	if !strings.HasSuffix(email, "@g.kogakuin.jp") {
		return domain.Fail("authentication-required", "@g.kogakuin.jp のGoogleアカウントでログインしてください。")
	}
	return nil
}

func (g *Google) clearCookies(tab context.Context) error {
	exec := cdp.WithExecutor(tab, cd.FromContext(tab).Browser)
	cookies, err := storage.GetCookies().Do(exec)
	if err != nil {
		return err
	}
	for _, cookie := range cookies {
		if !g.cookieDomain(cookie.Domain) {
			continue
		}
		deletion := network.DeleteCookies(cookie.Name).WithDomain(cookie.Domain).WithPath(cookie.Path)
		if cookie.PartitionKey != nil && !cookie.PartitionKeyOpaque {
			deletion = deletion.WithPartitionKey(cookie.PartitionKey)
		}
		if err := deletion.Do(tab); err != nil {
			return err
		}
	}
	return nil
}

func (g *Google) Status(ctx context.Context) (bool, error) {
	err := g.Login(ctx, false)
	var failure *domain.Error
	if errors.As(err, &failure) && failure.Reason == "authentication-required" {
		return false, nil
	}
	return err == nil, err
}

// CookieJar reads current cookies from the shared browser profile for Drive HTTP requests.
// Domain, path, expiry and Secure rules also apply to redirected requests.
func (g *Google) CookieJar(ctx context.Context) (http.CookieJar, error) {
	var cookies []*network.Cookie
	err := g.browser.withProviderAuth(ctx, false, false, true, func(tab context.Context) error {
		if err := g.verify(tab, false); err != nil {
			return err
		}
		var err error
		cookies, err = storage.GetCookies().Do(cdp.WithExecutor(tab, cd.FromContext(tab).Browser))
		return err
	})
	if err != nil {
		return nil, err
	}
	return g.cookieJar(cookies)
}

func (g *Google) cookieJar(cookies []*network.Cookie) (http.CookieJar, error) {
	jar, err := cookiejar.New(&cookiejar.Options{PublicSuffixList: publicsuffix.List})
	if err != nil {
		return nil, err
	}
	usable := 0
	for _, stored := range cookies {
		if stored == nil || !g.cookieDomain(stored.Domain) {
			continue
		}
		// A standard HTTP jar cannot represent partitioned cookies.
		if stored.PartitionKey != nil || stored.PartitionKeyOpaque {
			continue
		}
		if !stored.Session && stored.Expires <= float64(time.Now().Unix()) {
			continue
		}
		cookie := &http.Cookie{Name: stored.Name, Value: stored.Value, Path: stored.Path, Secure: stored.Secure, HttpOnly: stored.HTTPOnly}
		if strings.HasPrefix(stored.Domain, ".") {
			cookie.Domain = stored.Domain
		}
		if !stored.Session {
			cookie.Expires = time.Unix(0, int64(stored.Expires*float64(time.Second)))
		}
		origin := &url.URL{Scheme: "https", Host: strings.TrimPrefix(stored.Domain, "."), Path: "/"}
		jar.SetCookies(origin, []*http.Cookie{cookie})
		usable++
	}
	if usable == 0 {
		return nil, domain.Fail("authentication-required", "GoogleのセッションCookieを取得できません。")
	}
	return jar, nil
}
