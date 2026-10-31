package browser

import (
	"net/url"
	"strings"
	"time"

	"github.com/chromedp/cdproto/cdp"
	"github.com/chromedp/cdproto/network"
)

func cookieParam(cookie *network.Cookie) *network.CookieParam {
	// Opaque partition keys cannot be recreated through CDP.
	if cookie.PartitionKeyOpaque {
		return nil
	}
	param := &network.CookieParam{
		Name: cookie.Name, Value: cookie.Value, Domain: cookie.Domain, Path: cookie.Path,
		Secure: cookie.Secure, HTTPOnly: cookie.HTTPOnly, SameSite: cookie.SameSite,
		Priority: cookie.Priority, SourceScheme: cookie.SourceScheme, SourcePort: cookie.SourcePort,
		PartitionKey: cookie.PartitionKey,
	}
	if !cookie.Session {
		expires := cdp.TimeSinceEpoch(time.Unix(0, int64(cookie.Expires*1e9)))
		param.Expires = &expires
	}
	return param
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
