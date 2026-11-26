package browser

import (
	"context"
	"errors"
	"net/url"
	"slices"
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
	err := i.withProviderAuth(
		ctx,
		interactive,
		isolatedAuthPage,
		false,
		func(tab context.Context) error {
			exec := cdp.WithExecutor(tab, cd.FromContext(tab).Browser)
			cookies, err := storage.GetCookies().Do(exec)
			if err != nil {
				return err
			}
			info, err := target.GetTargetInfo().
				WithTargetID(cd.FromContext(tab).Target.TargetID).Do(exec)
			if err != nil {
				return err
			}
			contextID := info.BrowserContextID
			// Match the content browser's starting state: only SSO cookies, not
			// existing LMS, gateway, or Google sessions from the default context.
			params := ssoCookieParams(i.opts.SSOURL, cookies)
			if len(params) > 0 {
				if err := storage.SetCookies(params).
					WithBrowserContextID(contextID).
					Do(exec); err != nil {
					return err
				}
			}
			if err := cd.Run(tab, cd.ActionFunc(func(page context.Context) error {
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
			commit = cdp.WithExecutor(commit, cd.FromContext(tab).Browser)
			if err := i.replaceSSOCookies(commit, params); err != nil {
				return err
			}
			result = params
			return nil
		},
	)
	return result, err
}

// ctx has a browser-level executor and a bounded, caller-independent deadline.
func (i *KogakuinSSO) replaceSSOCookies(
	ctx context.Context,
	params []*network.CookieParam,
) (err error) {
	current, err := storage.GetCookies().Do(ctx)
	if err != nil {
		return err
	}
	// A failed CDP command may already have modified the jar. Do not persist
	// any part of a failed commit; the next runtime restores the last checkpoint.
	defer func() {
		if err != nil {
			i.cookiesReady = false
		}
	}()
	if err := storage.SetCookies(params).Do(ctx); err != nil {
		return err
	}
	installed, err := storage.GetCookies().Do(ctx)
	if err != nil {
		return err
	}
	for _, param := range params {
		if !slices.ContainsFunc(installed, func(cookie *network.Cookie) bool {
			actual := cookieParam(cookie)
			return actual != nil && sameCookieIdentity(actual, param) && actual.Value == param.Value
		}) {
			return Fail("authentication-storage", "更新したSSO Cookieを確認できません。再試行してください。")
		}
	}
	// Only remove obsolete identities after the replacements are installed.
	// Other providers and replacement cookies (including partitioned ones) stay.
	expired := cdp.TimeSinceEpoch(time.Now().Add(-time.Hour))
	var deletions []*network.CookieParam
	for _, previous := range ssoCookieParams(i.opts.SSOURL, current) {
		if !slices.ContainsFunc(params, func(param *network.CookieParam) bool {
			return sameCookieIdentity(previous, param)
		}) {
			previous.Expires = &expired
			deletions = append(deletions, previous)
		}
	}
	if len(deletions) > 0 {
		return storage.SetCookies(deletions).Do(ctx)
	}
	return nil
}

func sameCookieIdentity(a, b *network.CookieParam) bool {
	if a.Name != b.Name || a.Domain != b.Domain || a.Path != b.Path {
		return false
	}
	if a.PartitionKey == nil || b.PartitionKey == nil {
		return a.PartitionKey == b.PartitionKey
	}
	return *a.PartitionKey == *b.PartitionKey
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
