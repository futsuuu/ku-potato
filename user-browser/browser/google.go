package browser

import (
	"context"
	"errors"
	"net/url"
	"strings"
	"time"

	"github.com/chromedp/cdproto/cdp"
	"github.com/chromedp/cdproto/network"
	"github.com/chromedp/cdproto/storage"
	cd "github.com/chromedp/chromedp"
)

type Google struct {
	browser *Browser
	origin  string
	signin  string
}

func NewGoogle(browser *Browser) *Google {
	return &Google{
		browser: browser,
		origin:  "https://myaccount.google.com",
		signin:  "https://accounts.google.com/v3/signin/identifier",
	}
}

func (g *Google) accountExpression() string {
	// Read the active profile control, never remembered accounts or page text.
	return `(() => {
		if (document.readyState === 'loading' || location.origin !== ` + js(g.origin) + `) {
			return '';
		}
		for (const a of document.querySelectorAll('a[role="button"][aria-label][href]')) {
			const u = new URL(a.href);
			if (u.origin !== 'https://accounts.google.com' || u.pathname !== '/SignOutOptions'
				|| !a.getClientRects().length) {
				continue;
			}
			const emails = a.getAttribute('aria-label')
				.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi) || [];
			if (emails.length === 1) return emails[0].toLowerCase();
		}
		return '';
	})()`
}

func (g *Google) signedOutExpression() string {
	return `document.readyState === 'complete' && (
		(location.origin === 'https://www.google.com' && location.pathname === '/account/about/')
		|| (location.origin === 'https://accounts.google.com'
			&& /^\/(?:ServiceLogin|(?:v\d+\/)?signin(?:\/|$))/.test(location.pathname))
		|| (location.origin === ` + js(g.origin) + ` && !!document.querySelector('#identifierId'))
	)`
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
	return g.browser.withProviderAuth(
		ctx,
		interactive,
		false,
		true,
		func(tab context.Context) error {
			return g.verify(tab, interactive)
		},
	)
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
	if err := poll(
		tab,
		`!!(`+g.accountExpression()+`) || (`+g.signedOutExpression()+`)`,
	); err != nil {
		return err
	}
	var email string
	if err := cd.Run(tab, cd.Evaluate(g.accountExpression(), &email)); err != nil {
		return err
	}
	if !strings.HasSuffix(email, "@g.kogakuin.jp") {
		return Fail("authentication-required", "@g.kogakuin.jp のGoogleアカウントでログインしてください。")
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
		deletion := network.DeleteCookies(cookie.Name).
			WithDomain(cookie.Domain).
			WithPath(cookie.Path)
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
	var failure *Error
	if errors.As(err, &failure) && failure.Reason == "authentication-required" {
		return false, nil
	}
	return err == nil, err
}

// Read current cookies only after verifying the active university account.
func (g *Google) sessionCookies(ctx context.Context) ([]*network.Cookie, error) {
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
	return cookies, nil
}

// Cookies exports only usable Google session cookies, never the SSO session.
func (g *Google) Cookies(ctx context.Context) ([]*network.CookieParam, error) {
	cookies, err := g.sessionCookies(ctx)
	if err != nil {
		return nil, err
	}
	return g.cookieParams(cookies)
}

func (g *Google) cookieParams(cookies []*network.Cookie) ([]*network.CookieParam, error) {
	var result []*network.CookieParam
	for _, cookie := range cookies {
		if cookie == nil || !g.cookieDomain(cookie.Domain) ||
			cookie.PartitionKey != nil || cookie.PartitionKeyOpaque ||
			(!cookie.Session && cookie.Expires <= float64(time.Now().Unix())) {
			continue
		}
		result = append(result, cookieParam(cookie))
	}
	if len(result) == 0 {
		return nil, Fail("authentication-required", "GoogleのセッションCookieを取得できません。")
	}
	return result, nil
}
