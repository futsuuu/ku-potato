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
	"github.com/chromedp/cdproto/target"
	"github.com/chromedp/cdproto/webauthn"
	cd "github.com/chromedp/chromedp"
)

// KogakuinSSO uses only the authentication profile. The content browser never
// opens this profile or receives a WebAuthn private key.
type KogakuinSSO struct{ *Browser }

func NewKogakuinSSO(browser *Browser) *KogakuinSSO {
	return &KogakuinSSO{Browser: browser}
}

func (i *KogakuinSSO) Login(ctx context.Context, interactive bool) error {
	_, err := i.ssoCookies(ctx, interactive)
	return err
}

func (i *KogakuinSSO) Status(ctx context.Context) (bool, error) {
	err := i.Login(ctx, false)
	var failure *Error
	if errors.As(err, &failure) && failure.Reason == "authentication-required" {
		return false, nil
	}
	return err == nil, err
}

// SSOCookies verifies that SSO alone can establish a new LMS session. An existing
// LMS or university authentication session is not evidence that SSO is valid.
func (i *KogakuinSSO) SSOCookies(ctx context.Context) ([]*network.CookieParam, error) {
	return i.ssoCookies(ctx, false)
}

// RenewSSOCookies uses the same verification as SSOCookies: neither can bypass
// SSO using an existing LMS session. Only refreshed SSO cookies are persisted.
func (i *KogakuinSSO) RenewSSOCookies(ctx context.Context) ([]*network.CookieParam, error) {
	return i.ssoCookies(ctx, false)
}

func (i *KogakuinSSO) ssoCookies(
	ctx context.Context,
	interactive bool,
) ([]*network.CookieParam, error) {
	var result []*network.CookieParam
	err := i.withSessionAuth(ctx, interactive, true, func(tab context.Context) error {
		exec := cdp.WithExecutor(tab, cd.FromContext(tab).Browser)
		cookies, err := storage.GetCookies().Do(exec)
		if err != nil {
			return err
		}
		// Match the content browser's starting state, without deleting or sharing
		// provider sessions in the persistent authentication profile.
		contextID, err := target.CreateBrowserContext().WithDisposeOnDetach(true).Do(exec)
		if err != nil {
			return err
		}
		defer func() {
			cleanup, cancel := context.WithTimeout(i.root, 5*time.Second)
			defer cancel()
			_ = target.DisposeBrowserContext(contextID).
				Do(cdp.WithExecutor(cleanup, cd.FromContext(i.root).Browser))
		}()
		// Edge requires a window before a tab can be opened in a fresh context.
		pageID, err := target.CreateTarget("about:blank").
			WithBrowserContextID(contextID).WithNewWindow(true).Do(exec)
		if err != nil {
			return err
		}
		isolated, closeContext := cd.NewContext(tab, cd.WithTargetID(pageID))
		defer closeContext()
		if err := cd.Run(isolated); err != nil {
			return err
		}
		params := ssoCookieParams(i.opts.SSOURL, cookies)
		if len(params) > 0 {
			if err := storage.SetCookies(params).
				WithBrowserContextID(contextID).
				Do(exec); err != nil {
				return err
			}
		}
		if err := cd.Run(isolated, cd.ActionFunc(func(page context.Context) error {
			return i.authenticated(
				page,
				func(stored *credentials, _ webauthn.AuthenticatorID) error {
					return i.session(page, interactive, stored)
				},
			)
		})); err != nil {
			return err
		}
		refreshed, err := storage.GetCookies().WithBrowserContextID(contextID).Do(exec)
		if err != nil {
			return err
		}
		params = ssoCookieParams(i.opts.SSOURL, refreshed)
		if len(params) == 0 {
			return Fail("authentication-required", "統合認証システムに再ログインしてください。")
		}
		// Replace only the SSO snapshot after successful verification. Finish
		// this bounded commit even if the caller cancels halfway through it.
		if err := tab.Err(); err != nil {
			return err
		}
		commit, cancel := context.WithTimeout(i.root, 5*time.Second)
		defer cancel()
		origin, _ := url.Parse(i.opts.SSOURL)
		for _, cookie := range cookies {
			if !ssoCookieDomain(origin.Hostname(), cookie.Domain) {
				continue
			}
			deletion := network.DeleteCookies(cookie.Name).
				WithDomain(cookie.Domain).
				WithPath(cookie.Path)
			if cookie.PartitionKey != nil && !cookie.PartitionKeyOpaque {
				deletion = deletion.WithPartitionKey(cookie.PartitionKey)
			}
			if err := deletion.Do(
				cdp.WithExecutor(commit, cd.FromContext(tab).Target),
			); err != nil {
				return err
			}
		}
		if err := storage.SetCookies(params).
			Do(cdp.WithExecutor(commit, cd.FromContext(tab).Browser)); err != nil {
			return err
		}
		result = params
		return nil
	})
	return result, err
}

func ssoCookieParams(rawURL string, cookies []*network.Cookie) []*network.CookieParam {
	ssoSystem, err := url.Parse(rawURL)
	if err != nil || ssoSystem.Hostname() == "" {
		return nil
	}
	var params []*network.CookieParam
	for _, cookie := range cookies {
		if cookie == nil || !ssoCookieDomain(ssoSystem.Hostname(), cookie.Domain) ||
			(!cookie.Session && cookie.Expires <= float64(time.Now().Unix())) {
			continue
		}
		if param := cookieParam(cookie); param != nil {
			params = append(params, param)
		}
	}
	return params
}

func ssoCookieDomain(host, domain string) bool {
	domain = strings.TrimPrefix(domain, ".")
	return domain != "" && (host == domain || strings.HasSuffix(host, "."+domain))
}
