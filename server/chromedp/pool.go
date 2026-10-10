package chromedp

import (
	"context"
	"errors"
	"net/url"
	"path/filepath"
	"strings"
	"time"

	"github.com/chromedp/cdproto/cdp"
	"github.com/chromedp/cdproto/network"
	"github.com/chromedp/cdproto/storage"
	"github.com/chromedp/cdproto/target"
	"github.com/chromedp/cdproto/webauthn"
	cd "github.com/chromedp/chromedp"
)

// The CDP target belongs to the server lifetime. Only the operation is cancelled.
func operationContext(page, request context.Context) (context.Context, context.CancelFunc) {
	ctx, cancel := context.WithCancel(page)
	stop := context.AfterFunc(request, cancel)
	if request.Err() != nil {
		cancel()
	}
	return ctx, func() { stop(); cancel() }
}

func (b *Browser) reset(slot *pageSlot) {
	if slot.cancel != nil {
		slot.cancel()
	}
	slot.ctx, slot.cancel = nil, nil
}

func (b *Browser) stopRuntime() {
	for _, slot := range b.slots {
		b.reset(slot)
	}
	if b.root != nil && cd.FromContext(b.root).Browser != nil {
		shutdown, cancel := context.WithTimeout(b.root, 5*time.Second)
		_ = cd.Cancel(shutdown)
		cancel()
	}
	if b.cancelRoot != nil {
		b.cancelRoot()
	}
	if b.cancelAlloc != nil {
		b.cancelAlloc()
	}
	b.root, b.cancelRoot, b.cancelAlloc = nil, nil, nil
}

func (b *Browser) Close() error {
	b.gate.Lock()
	defer b.gate.Unlock()
	b.closed = true
	b.stopRuntime()
	return nil
}

// Caller holds authMu; mode changes require the exclusive gate as well.
func (b *Browser) start(ctx context.Context, interactive bool) error {
	if b.closed {
		return errors.New("browser is closed")
	}
	if b.root != nil {
		if b.root.Err() != nil {
			return b.root.Err()
		}
		if b.interactive == interactive {
			return nil
		}
		if err := b.saveCookies(ctx); err != nil {
			return err
		}
		b.stopRuntime()
	}
	opts := append([]cd.ExecAllocatorOption{}, cd.DefaultExecAllocatorOptions[:]...)
	opts = append(opts, cd.UserDataDir(filepath.Join(b.opts.StateDir, "profile")), cd.Flag("disk-cache-dir", b.opts.CacheDir), cd.Flag("headless", !interactive), cd.Flag("disable-dev-shm-usage", true))
	if !interactive {
		opts = append(opts, cd.Flag("headless", "new"))
	}
	if b.opts.Executable != "" {
		opts = append(opts, cd.ExecPath(b.opts.Executable))
	}
	alloc, cancelAlloc := cd.NewExecAllocator(context.Background(), opts...)
	// The chromedp cancel function also waits for allocation. A failed startup
	// has no allocated browser to wait for, so retain the parent's raw cancel.
	parent, cancelRoot := context.WithCancel(alloc)
	b.root, _ = cd.NewContext(parent)
	b.cancelRoot = cancelRoot
	b.cancelAlloc = cancelAlloc
	stop := context.AfterFunc(ctx, b.cancelRoot)
	defer stop()
	if err := cd.Run(b.root); err != nil {
		b.stopRuntime()
		return err
	}
	if err := b.restoreCookies(ctx); err != nil {
		b.stopRuntime()
		return err
	}
	return nil
}

func (b *Browser) withAuth(ctx context.Context, interactive, dedicated bool, use func(context.Context, *credentials, webauthn.AuthenticatorID) error) error {
	b.gate.Lock()
	defer b.gate.Unlock()
	b.authMu.Lock()
	defer b.authMu.Unlock()
	if ctx.Err() != nil {
		return ctx.Err()
	}
	if b.root != nil && b.root.Err() != nil {
		b.stopRuntime()
	}
	if err := b.start(ctx, interactive); err != nil {
		return sourceError(ctx, err)
	}
	b.interactive = interactive
	// Authentication can change the account/session; do not retain obsolete workers.
	for _, slot := range b.slots {
		b.reset(slot)
	}
	page := b.root
	if dedicated {
		var closePage context.CancelFunc
		page, closePage = cd.NewContext(b.root)
		defer closePage()
		stop := context.AfterFunc(ctx, closePage)
		err := cd.Run(page)
		stop()
		if err != nil {
			return sourceError(ctx, err)
		}
	}
	op, cancel := operationContext(page, ctx)
	defer cancel()
	err := cd.Run(op, cd.ActionFunc(func(tab context.Context) error {
		if err := target.ActivateTarget(cd.FromContext(tab).Target.TargetID).Do(cdp.WithExecutor(tab, cd.FromContext(tab).Browser)); err != nil {
			return err
		}
		return b.authenticated(tab, func(stored *credentials, id webauthn.AuthenticatorID) error { return use(tab, stored, id) })
	}))
	if err == nil {
		err = b.saveCookies(ctx)
		if err == nil && interactive {
			b.stopRuntime()
			b.interactive = false
		}
	}
	return sourceError(ctx, err)
}

// Credentials and counters are loaded and saved under authMu in all contexts.
func (b *Browser) authenticated(tab context.Context, use func(*credentials, webauthn.AuthenticatorID) error) error {
	stored, err := b.loadCredentials()
	if err != nil {
		return err
	}
	var id webauthn.AuthenticatorID
	if stored != nil {
		id, err = newAuthenticator(tab, stored)
		if err != nil {
			return err
		}
	}
	result := use(stored, id)
	if id != "" {
		cleanup, cancel := context.WithTimeout(context.WithoutCancel(tab), 5*time.Second)
		defer cancel()
		if err := b.saveCredentials(cleanup, id, stored.Username); result == nil {
			result = err
		}
		_ = webauthn.RemoveVirtualAuthenticator(id).Do(cleanup)
	}
	return result
}

// Share only SSO cookies. Copying LMS cookies would share its server-side session.
func (b *Browser) copySSO(ctx context.Context, from, to cdp.BrowserContextID) error {
	portal, err := url.Parse(b.opts.PortalURL)
	if err != nil {
		return err
	}
	exec := cdp.WithExecutor(ctx, cd.FromContext(ctx).Browser)
	cookies, err := storage.GetCookies().WithBrowserContextID(from).Do(exec)
	if err != nil {
		return err
	}
	var params []*network.CookieParam
	for _, cookie := range cookies {
		domain := strings.TrimPrefix(cookie.Domain, ".")
		if portal.Hostname() != domain && !strings.HasSuffix(portal.Hostname(), "."+domain) {
			continue
		}
		if param := cookieParam(cookie); param != nil {
			params = append(params, param)
		}
	}
	if len(params) == 0 {
		return nil
	}
	return storage.SetCookies(params).WithBrowserContextID(to).Do(exec)
}

func (b *Browser) withPage(ctx context.Context, use func(context.Context) error) error {
	// A failed interactive operation may still have a headed browser. Preserve
	// its cookies before switching to the headless runtime used for normal work.
	b.gate.RLock()
	if b.interactive {
		b.gate.RUnlock()
		b.gate.Lock()
		var modeErr error
		if b.interactive {
			if b.root != nil && b.root.Err() == nil {
				modeErr = b.saveCookies(ctx)
			}
			if modeErr == nil {
				b.stopRuntime()
				b.interactive = false
			}
		}
		b.gate.Unlock()
		if modeErr != nil {
			return sourceError(ctx, modeErr)
		}
		b.gate.RLock()
	}
	err := b.usePage(ctx, use)
	crashed := false
	if err != nil {
		b.authMu.Lock()
		crashed = b.root != nil && b.root.Err() != nil
		b.authMu.Unlock()
	}
	b.gate.RUnlock()
	// A browser crash cancels all leased pages. Reset only after their leases end.
	if crashed {
		b.gate.Lock()
		if b.root != nil && b.root.Err() != nil {
			b.stopRuntime()
		}
		b.gate.Unlock()
	}
	return sourceError(ctx, err)
}

func (b *Browser) usePage(ctx context.Context, use func(context.Context) error) error {
	var slot *pageSlot
	select {
	case slot = <-b.available:
	case <-ctx.Done():
		return ctx.Err()
	}
	defer func() { b.available <- slot }()
	b.authMu.Lock()
	err := b.start(ctx, false)
	if err == nil && slot.ctx == nil {
		err = b.createPage(ctx, slot)
	}
	if err != nil {
		if slot.ctx != nil {
			b.reset(slot)
		}
		b.authMu.Unlock()
		return err
	}
	op, cancel := operationContext(slot.ctx, ctx)
	defer cancel()
	err = cd.Run(op, cd.ActionFunc(func(tab context.Context) error {
		if err := target.ActivateTarget(cd.FromContext(tab).Target.TargetID).Do(cdp.WithExecutor(tab, cd.FromContext(tab).Browser)); err != nil {
			return err
		}
		id := cd.FromContext(tab).BrowserContextID
		if err := b.copySSO(tab, "", id); err != nil {
			return err
		}
		if err := b.authenticated(tab, func(stored *credentials, _ webauthn.AuthenticatorID) error { return b.session(tab, false, stored) }); err != nil {
			return err
		}
		// SSO can rotate its cookies. Publish the latest state before another
		// context authenticates and retain it in the persistent profile.
		if err := b.copySSO(tab, id, ""); err != nil {
			return err
		}
		return b.saveCookies(ctx)
	}))
	b.authMu.Unlock()
	if err == nil {
		err = use(op)
	}
	if err != nil {
		b.reset(slot)
	}
	return err
}

func (b *Browser) createPage(ctx context.Context, slot *pageSlot) error {
	op, cancel := operationContext(b.root, ctx)
	defer cancel()
	exec := cdp.WithExecutor(op, cd.FromContext(b.root).Browser)
	id, err := target.CreateBrowserContext().WithDisposeOnDetach(true).Do(exec)
	if err != nil {
		return err
	}
	dispose := func() {
		cleanup, cancel := context.WithTimeout(b.root, 5*time.Second)
		defer cancel()
		_ = target.DisposeBrowserContext(id).Do(cdp.WithExecutor(cleanup, cd.FromContext(b.root).Browser))
	}
	// A fresh context has no browser window. Explicitly create one for Chromium
	// variants (including Edge) that cannot create a tab without a window.
	tabID, err := target.CreateTarget("about:blank").WithBrowserContextID(id).WithNewWindow(true).Do(exec)
	if err != nil {
		dispose()
		return err
	}
	page, closePage := cd.NewContext(b.root, cd.WithExistingBrowserContext(id))
	slot.ctx, slot.cancel = page, func() { closePage(); dispose() }
	stop := context.AfterFunc(ctx, closePage)
	err = cd.Run(page)
	stop()
	if err == nil {
		err = target.CloseTarget(tabID).Do(exec)
	}
	return err
}
