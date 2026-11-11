package userbrowser

import (
	"context"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"strings"
	"time"

	"github.com/futsuuu/ku-potato/app-server/application/outport"
	"github.com/futsuuu/ku-potato/app-server/domain"
	userproto "github.com/futsuuu/ku-potato/user-browser/protocol"
	"golang.org/x/net/publicsuffix"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/emptypb"
)

type authentication struct {
	rpc      userproto.UserBrowserClient
	provider userproto.Provider
}
type (
	LMS    struct{ authentication }
	Google struct{ authentication }
)

var (
	_ outport.LMSAuthentication = (*LMS)(nil)
	_ outport.Authentication    = (*Google)(nil)
)

func NewLMS(rpc userproto.UserBrowserClient) *LMS {
	return &LMS{authentication{rpc: rpc, provider: userproto.Provider_PROVIDER_LMS}}
}

func NewGoogle(rpc userproto.UserBrowserClient) *Google {
	return &Google{authentication{rpc: rpc, provider: userproto.Provider_PROVIDER_GOOGLE}}
}

func translate(err error) error {
	if err == nil {
		return nil
	}
	code := status.Code(err)
	if code == codes.Canceled {
		return context.Canceled
	}
	if code == codes.DeadlineExceeded {
		return context.DeadlineExceeded
	}
	if code == codes.FailedPrecondition {
		for _, detail := range status.Convert(err).Details() {
			if failure, ok := detail.(*userproto.Failure); ok {
				reason := map[userproto.FailureReason]string{
					userproto.FailureReason_FAILURE_REASON_AUTHENTICATION_REQUIRED: "authentication-required",
					userproto.FailureReason_FAILURE_REASON_AUTHENTICATION_STORAGE:  "authentication-storage",
					userproto.FailureReason_FAILURE_REASON_BROWSER_START:           "browser-start",
					userproto.FailureReason_FAILURE_REASON_SOURCE:                  "source",
					userproto.FailureReason_FAILURE_REASON_CONFLICT:                "conflict",
				}[failure.GetReason()]
				if reason != "" {
					return domain.Fail(reason, failure.GetMessage())
				}
			}
		}
	}
	return domain.Fail("source", "ユーザーブラウザに接続できません。")
}

func (a *authentication) Login(ctx context.Context, interactive bool) error {
	_, err := a.rpc.Login(
		ctx,
		&userproto.LoginRequest{Provider: a.provider, Interactive: interactive},
	)
	return translate(err)
}

func (a *authentication) Status(ctx context.Context) (bool, error) {
	result, err := a.rpc.Status(ctx, &userproto.ProviderRequest{Provider: a.provider})
	if err != nil {
		return false, translate(err)
	}
	return result.GetAuthenticated(), nil
}

func (a *LMS) RegisterWebAuthn(ctx context.Context, interactive bool) error {
	_, err := a.rpc.RegisterWebAuthn(ctx, &userproto.InteractiveRequest{Interactive: interactive})
	return translate(err)
}

func (a *LMS) WebAuthnRegistrationStatus(ctx context.Context) (domain.RegistrationResult, error) {
	result, err := a.rpc.WebAuthnRegistrationStatus(ctx, &emptypb.Empty{})
	if err != nil {
		return domain.RegistrationResult{}, translate(err)
	}
	return domain.RegistrationResult{Registered: result.GetRegistered()}, nil
}

func (a *LMS) DeleteWebAuthn(ctx context.Context) error {
	_, err := a.rpc.DeleteWebAuthn(ctx, &emptypb.Empty{})
	return translate(err)
}

func (a *LMS) SSOCookies(ctx context.Context, renew bool) (*userproto.Cookies, error) {
	result, err := a.rpc.SSOCookies(ctx, &userproto.SSOCookiesRequest{Renew: renew})
	return result, translate(err)
}

func (g *Google) CookieJar(ctx context.Context) (http.CookieJar, error) {
	result, err := g.rpc.GoogleCookies(ctx, &emptypb.Empty{})
	if err != nil {
		return nil, translate(err)
	}
	return googleCookieJar(result.GetCookies())
}

func googleCookieJar(cookies []*userproto.Cookie) (http.CookieJar, error) {
	jar, err := cookiejar.New(&cookiejar.Options{PublicSuffixList: publicsuffix.List})
	if err != nil {
		return nil, err
	}
	usable := 0
	for _, stored := range cookies {
		if stored == nil || stored.GetPartitionKey() != nil {
			continue
		}
		host := strings.TrimPrefix(stored.GetDomain(), ".")
		allowed := false
		for _, suffix := range []string{"google.com", "google.co.jp", "googleusercontent.com"} {
			if host == suffix || strings.HasSuffix(host, "."+suffix) {
				allowed = true
				break
			}
		}
		if !allowed {
			continue
		}
		cookie := &http.Cookie{
			Name: stored.GetName(), Value: stored.GetValue(), Path: stored.GetPath(),
			Secure: stored.GetSecure(), HttpOnly: stored.GetHttpOnly(),
		}
		if strings.HasPrefix(stored.GetDomain(), ".") {
			cookie.Domain = stored.GetDomain()
		}
		if expires := stored.GetExpires(); expires != nil {
			if expires.CheckValid() != nil {
				return nil, domain.Fail("source", "認証Cookieが不正です。")
			}
			cookie.Expires = expires.AsTime()
			if !cookie.Expires.After(time.Now()) {
				continue
			}
		}
		origin := &url.URL{Scheme: "https", Host: host, Path: "/"}
		jar.SetCookies(origin, []*http.Cookie{cookie})
		usable++
	}
	if usable == 0 {
		return nil, domain.Fail("authentication-required", "GoogleのセッションCookieを取得できません。")
	}
	return jar, nil
}
