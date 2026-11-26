package browser

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
)

func (b *Browser) cookiePath() string {
	return filepath.Join(b.opts.StateDir, "auth", "cookies.json")
}

func (b *Browser) loadCookies() ([]*network.CookieParam, error) {
	body, err := os.ReadFile(b.cookiePath())
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, Fail("authentication-storage", "Cookieを読み込めません。")
	}
	var cookies []*network.CookieParam
	if json.Unmarshal(body, &cookies) != nil {
		return nil, Fail("authentication-storage", "保存済みのCookieが不正です。")
	}
	params := make([]*network.CookieParam, 0, len(cookies))
	for _, cookie := range cookies {
		if cookie == nil || cookie.Domain == "" {
			return nil, Fail("authentication-storage", "保存済みのCookieが不正です。")
		}
		if cookie.Expires != nil && !time.Time(*cookie.Expires).After(time.Now()) {
			continue
		}
		params = append(params, cookie)
	}
	return params, nil
}

func (b *Browser) restoreCookies(ctx context.Context) error {
	cookies, err := b.loadCookies()
	if err != nil {
		return err
	}
	exec := cdp.WithExecutor(ctx, cd.FromContext(ctx).Browser)
	// The snapshot is authoritative, including deletions and logout. Do not
	// merge it with stale persistent cookies from the browser profile.
	if err := storage.ClearCookies().Do(exec); err != nil {
		return Fail("authentication-storage", "Cookieを復元できません。")
	}
	if len(cookies) > 0 {
		if err := storage.SetCookies(cookies).Do(exec); err != nil {
			return Fail("authentication-storage", "Cookieを復元できません。")
		}
	}
	return nil
}

// The boolean distinguishes an invalidated jar from a saved checkpoint.
func (b *Browser) saveCookies() (bool, error) {
	if !b.cookiesReady {
		return false, nil
	}
	ctx, cancel := context.WithTimeout(b.root, 5*time.Second)
	defer cancel()
	if err := b.checkAuthPages(ctx); err != nil {
		return false, Fail("authentication-storage", "Cookieを取得できません。")
	}
	if !b.cookiesReady {
		return false, nil
	}
	exec := cdp.WithExecutor(ctx, cd.FromContext(ctx).Browser)
	cookies, err := storage.GetCookies().Do(exec)
	if err != nil {
		return false, Fail("authentication-storage", "Cookieを取得できません。")
	}
	// The last ordinary window can close while GetCookies is in flight.
	if err := b.checkAuthPages(ctx); err != nil {
		return false, Fail("authentication-storage", "Cookieを取得できません。")
	}
	if !b.cookiesReady {
		return false, nil
	}
	params := make([]*network.CookieParam, 0, len(cookies))
	for _, cookie := range cookies {
		if !cookie.Session && cookie.Expires <= float64(time.Now().Unix()) {
			continue
		}
		if param := cookieParam(cookie); param != nil {
			params = append(params, param)
		}
	}
	if err := os.MkdirAll(filepath.Dir(b.cookiePath()), 0o700); err != nil {
		return false, Fail("authentication-storage", "Cookieを保存できません。")
	}
	if err := atomicJSON(b.cookiePath(), params); err != nil {
		return false, Fail("authentication-storage", "Cookieを保存できません。")
	}
	return true, nil
}
