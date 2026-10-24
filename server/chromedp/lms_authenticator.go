package chromedp

import (
	"context"
	"errors"
	"net/url"
	"strings"
	"time"

	"github.com/chromedp/cdproto/cdp"
	"github.com/chromedp/cdproto/network"
	"github.com/chromedp/cdproto/storage"
	"github.com/chromedp/cdproto/webauthn"
	cd "github.com/chromedp/chromedp"
	"github.com/futsuuu/ku-potato/server/core/outport"
	"github.com/futsuuu/ku-potato/server/domain"
)

// LMSAuthenticator uses only the authentication profile. The content browser never
// opens this profile or receives a WebAuthn private key.
type LMSAuthenticator struct{ *Browser }

var _ outport.LMSAuthentication = (*LMSAuthenticator)(nil)

func NewLMSAuthenticator(browser *Browser) *LMSAuthenticator {
	return &LMSAuthenticator{Browser: browser}
}

func (i *LMSAuthenticator) Login(ctx context.Context, interactive bool) error {
	return i.withAuth(ctx, interactive, true, func(tab context.Context, stored *credentials, _ webauthn.AuthenticatorID) error {
		if interactive {
			// An LMS session can remain valid after its SSO session expires.
			// Force an explicit login through SSO without touching Google cookies.
			if err := i.clearLMSCookies(tab); err != nil {
				return err
			}
		}
		return i.session(tab, interactive, stored)
	})
}

func (i *LMSAuthenticator) Status(ctx context.Context) (bool, error) {
	err := i.Login(ctx, false)
	var failure *domain.Error
	if errors.As(err, &failure) && failure.Reason == "authentication-required" {
		return false, nil
	}
	return err == nil, err
}

func (i *LMSAuthenticator) clearLMSCookies(tab context.Context) error {
	origin, err := url.Parse(i.opts.LMSURL)
	if err != nil {
		return err
	}
	cookies, err := storage.GetCookies().Do(cdp.WithExecutor(tab, cd.FromContext(tab).Browser))
	if err != nil {
		return err
	}
	for _, cookie := range cookies {
		if !ssoCookieDomain(origin.Hostname(), cookie.Domain) {
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

// SSOCookies returns only the current SSO session. The caller must not
// persist the snapshot: it can expire or rotate on either side of the bridge.
func (i *LMSAuthenticator) SSOCookies(ctx context.Context) ([]*network.CookieParam, error) {
	var result []*network.CookieParam
	err := i.withAuth(ctx, false, true, func(tab context.Context, stored *credentials, _ webauthn.AuthenticatorID) error {
		if err := i.session(tab, false, stored); err != nil {
			return err
		}
		cookies, err := storage.GetCookies().Do(cdp.WithExecutor(tab, cd.FromContext(tab).Browser))
		if err != nil {
			return err
		}
		result = ssoCookieParams(i.opts.SSOURL, cookies)
		if len(result) == 0 {
			return domain.Fail("authentication-required", "統合認証システムに再ログインしてください。")
		}
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
		if cookie == nil || !ssoCookieDomain(ssoSystem.Hostname(), cookie.Domain) || (!cookie.Session && cookie.Expires <= float64(time.Now().Unix())) {
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
	return host == domain || strings.HasSuffix(host, "."+domain)
}
