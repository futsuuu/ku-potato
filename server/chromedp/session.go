package chromedp

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"time"

	"github.com/chromedp/cdproto/cdp"
	"github.com/chromedp/cdproto/network"
	"github.com/chromedp/cdproto/storage"
	cd "github.com/chromedp/chromedp"
	"github.com/futsuuu/ku-potato/server/domain"
)

type cookieState struct {
	Version int                    `json:"version"`
	Cookies []*network.CookieParam `json:"cookies"`
}

func (b *Browser) cookiePath() string { return filepath.Join(b.opts.StateDir, "cookies.json") }

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

// Caller holds authMu or the exclusive gate. Only the default context is saved;
// worker LMS sessions remain isolated and their SSO updates are published first.
func (b *Browser) saveCookies(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	op, cancel := operationContext(b.root, ctx)
	defer cancel()
	cookies, err := storage.GetCookies().Do(cdp.WithExecutor(op, cd.FromContext(b.root).Browser))
	if err != nil {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		return domain.Fail("authentication-storage", "認証Cookieを取得できません。")
	}
	state := cookieState{Version: 1, Cookies: []*network.CookieParam{}}
	for _, cookie := range cookies {
		if param := cookieParam(cookie); param != nil {
			state.Cookies = append(state.Cookies, param)
		}
	}
	if err := atomicJSON(b.cookiePath(), state); err != nil {
		return domain.Fail("authentication-storage", "認証Cookieを保存できません。")
	}
	return nil
}

func (b *Browser) restoreCookies(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	body, err := os.ReadFile(b.cookiePath())
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return domain.Fail("authentication-storage", "認証Cookieを読み込めません。")
	}
	var state cookieState
	if json.Unmarshal(body, &state) != nil || state.Version != 1 || state.Cookies == nil {
		return domain.Fail("authentication-storage", "保存済みの認証Cookieが不正です。")
	}
	for _, cookie := range state.Cookies {
		if cookie == nil || cookie.Domain == "" || cookie.Path == "" {
			return domain.Fail("authentication-storage", "保存済みの認証Cookieが不正です。")
		}
	}
	op, cancel := operationContext(b.root, ctx)
	defer cancel()
	exec := cdp.WithExecutor(op, cd.FromContext(b.root).Browser)
	// Replace profile cookies so deleted or rotated tokens are not resurrected.
	if err := storage.ClearCookies().Do(exec); err != nil {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		return domain.Fail("authentication-storage", "認証Cookieを復元できません。")
	}
	if len(state.Cookies) > 0 {
		if err := storage.SetCookies(state.Cookies).Do(exec); err != nil {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			return domain.Fail("authentication-storage", "認証Cookieを復元できません。")
		}
	}
	return nil
}
