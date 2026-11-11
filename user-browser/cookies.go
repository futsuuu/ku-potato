package userbrowser

import (
	"github.com/chromedp/cdproto/network"
	chromedp "github.com/futsuuu/ku-potato/user-browser/browser"
	userproto "github.com/futsuuu/ku-potato/user-browser/protocol"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func encodeCookie(cookie *network.CookieParam) (*userproto.Cookie, error) {
	part := &userproto.Cookie{
		Name:       cookie.Name,
		Value:      cookie.Value,
		Domain:     cookie.Domain,
		Path:       cookie.Path,
		Secure:     cookie.Secure,
		HttpOnly:   cookie.HTTPOnly,
		SourcePort: cookie.SourcePort,
	}
	switch cookie.SameSite {
	case "":
		part.SameSite = userproto.CookieSameSite_COOKIE_SAME_SITE_UNSPECIFIED
	case network.CookieSameSiteStrict:
		part.SameSite = userproto.CookieSameSite_COOKIE_SAME_SITE_STRICT
	case network.CookieSameSiteLax:
		part.SameSite = userproto.CookieSameSite_COOKIE_SAME_SITE_LAX
	case network.CookieSameSiteNone:
		part.SameSite = userproto.CookieSameSite_COOKIE_SAME_SITE_NONE
	default:
		return nil, chromedp.Fail("source", "認証Cookieが不正です。")
	}
	switch cookie.Priority {
	case "":
		part.Priority = userproto.CookiePriority_COOKIE_PRIORITY_UNSPECIFIED
	case network.CookiePriorityLow:
		part.Priority = userproto.CookiePriority_COOKIE_PRIORITY_LOW
	case network.CookiePriorityMedium:
		part.Priority = userproto.CookiePriority_COOKIE_PRIORITY_MEDIUM
	case network.CookiePriorityHigh:
		part.Priority = userproto.CookiePriority_COOKIE_PRIORITY_HIGH
	default:
		return nil, chromedp.Fail("source", "認証Cookieが不正です。")
	}
	switch cookie.SourceScheme {
	case "":
		part.SourceScheme = userproto.CookieSourceScheme_COOKIE_SOURCE_SCHEME_UNSPECIFIED
	case network.CookieSourceSchemeUnset:
		part.SourceScheme = userproto.CookieSourceScheme_COOKIE_SOURCE_SCHEME_UNSET
	case network.CookieSourceSchemeNonSecure:
		part.SourceScheme = userproto.CookieSourceScheme_COOKIE_SOURCE_SCHEME_NON_SECURE
	case network.CookieSourceSchemeSecure:
		part.SourceScheme = userproto.CookieSourceScheme_COOKIE_SOURCE_SCHEME_SECURE
	default:
		return nil, chromedp.Fail("source", "認証Cookieが不正です。")
	}
	if cookie.PartitionKey != nil {
		part.PartitionKey = &userproto.PartitionKey{
			TopLevelSite:         cookie.PartitionKey.TopLevelSite,
			HasCrossSiteAncestor: cookie.PartitionKey.HasCrossSiteAncestor,
		}
	}
	if cookie.Expires != nil {
		part.Expires = timestamppb.New(cookie.Expires.Time())
	}
	return part, nil
}

func encodeCookies(cookies []*network.CookieParam) (*userproto.Cookies, error) {
	result := &userproto.Cookies{}
	for _, cookie := range cookies {
		if cookie == nil {
			continue
		}
		part, err := encodeCookie(cookie)
		if err != nil {
			return nil, browserError(err)
		}
		result.Cookies = append(result.Cookies, part)
	}
	return result, nil
}
