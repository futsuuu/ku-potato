package browserauth

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

func googleCookieDomain(domain string) bool {
	domain = strings.TrimPrefix(domain, ".")
	for _, suffix := range []string{"google.com", "google.co.jp", "googleusercontent.com"} {
		if domain == suffix || strings.HasSuffix(domain, "."+suffix) {
			return true
		}
	}
	return false
}
func (g *Google) cookieDomain(domain string) bool {
	if googleCookieDomain(domain) {
		return true
	}
	origin, err := url.Parse(g.origin)
	return err == nil && origin.Hostname() != "" && strings.TrimPrefix(domain, ".") == origin.Hostname()
}
