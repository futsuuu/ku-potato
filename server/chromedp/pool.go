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
	"github.com/chromedp/cdproto/target"
	"github.com/chromedp/cdproto/webauthn"
	cd "github.com/chromedp/chromedp"
	"github.com/futsuuu/ku-potato/server/domain"
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
	if b.closeProcess != nil {
		b.closeProcess()
		b.closeProcess = nil
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
		b.stopRuntime()
	}
	opts := append([]cd.ExecAllocatorOption{}, cd.DefaultExecAllocatorOptions[:]...)
	opts = append(opts, cd.UserDataDir(b.opts.ProfileDir), cd.Flag("disk-cache-dir", b.opts.CacheDir), cd.Flag("headless", !interactive), cd.Flag("disable-dev-shm-usage", true), cd.Flag("allow-browser-signin", "false"), cd.Flag("restore-last-session", true))
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
		if ctx.Err() != nil {
			return ctx.Err()
		}
		return domain.Fail("browser-start", "Chrome を起動できません。KU-POTATO 用の Chrome が残っていないか、Chrome のパスと認証プロファイルの使用状況を確認してください。")
	}
	closeProcess, err := manageProcess(cd.FromContext(b.root).Browser.Process())
	if err != nil {
		b.stopRuntime()
		return domain.Fail("browser-start", "Chrome のプロセス管理を設定できません。")
	}
	b.closeProcess = closeProcess
	return nil
}

func (b *Browser) withAuth(ctx context.Context, interactive, dedicated bool, use func(context.Context, *credentials, webauthn.AuthenticatorID) error) error {
	return b.withSessionAuth(ctx, interactive, dedicated, func(tab context.Context) error {
		return b.authenticated(tab, func(stored *credentials, id webauthn.AuthenticatorID) error { return use(tab, stored, id) })
	})
}

func (b *Browser) withSessionAuth(ctx context.Context, interactive, dedicated bool, use func(context.Context) error) error {
	return b.withProviderAuth(ctx, interactive, dedicated, false, use)
}

func (b *Browser) withProviderAuth(ctx context.Context, interactive, dedicated, google bool, use func(context.Context) error) error {
	// A healthy headless runtime can authenticate on its root tab while worker
	// pages keep running. Mode changes and crash cleanup still need exclusivity.
	if !interactive {
		b.gate.RLock()
		b.authMu.Lock()
		if b.root != nil && b.root.Err() == nil && !b.interactive {
			err := b.runProviderAuth(ctx, interactive, dedicated, google, false, use)
			b.authMu.Unlock()
			b.gate.RUnlock()
			return sourceError(ctx, err)
		}
		b.authMu.Unlock()
		b.gate.RUnlock()
	}
	b.gate.Lock()
	defer b.gate.Unlock()
	b.authMu.Lock()
	defer b.authMu.Unlock()
	return sourceError(ctx, b.runProviderAuth(ctx, interactive, dedicated, google, true, use))
}

// Caller holds authMu and either the shared gate for a healthy headless
// runtime or the exclusive gate for startup and mode changes.
func (b *Browser) runProviderAuth(ctx context.Context, interactive, dedicated, google, exclusive bool, use func(context.Context) error) error {
	if ctx.Err() != nil {
		return ctx.Err()
	}
	if b.root != nil && b.root.Err() != nil {
		if !exclusive {
			return b.root.Err()
		}
		b.stopRuntime()
	}
	if err := b.start(ctx, interactive); err != nil {
		return err
	}
	if interactive {
		b.interactive = true
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
			return err
		}
	}
	op, cancel := operationContext(page, ctx)
	defer cancel()
	err := cd.Run(op, cd.ActionFunc(func(tab context.Context) error {
		if err := target.ActivateTarget(cd.FromContext(tab).Target.TargetID).Do(cdp.WithExecutor(tab, cd.FromContext(tab).Browser)); err != nil {
			return err
		}
		return use(tab)
	}))
	if err == nil {
		if interactive {
			b.stopRuntime()
			b.interactive = false
			if !google && !dedicated {
				err = b.start(ctx, false)
			}
		}
		if err == nil && !google && !dedicated {
			err = b.prepareWorkers(ctx)
		}
	}
	return err
}

func (b *Browser) prepareWorkers(ctx context.Context) error {
	// Only inspect idle slots; leased pages can finish while authentication runs.
	var idle []*pageSlot
drain:
	for range b.slots {
		select {
		case slot := <-b.available:
			idle = append(idle, slot)
		default:
			break drain
		}
	}
	var missing []*pageSlot
	for _, slot := range idle {
		if slot.ctx == nil {
			missing = append(missing, slot)
		} else {
			b.available <- slot
		}
	}
	defer func() {
		for _, slot := range missing {
			b.available <- slot
		}
	}()
	for _, slot := range missing {
		if err := b.preparePage(ctx, slot); err != nil {
			return err
		}
	}
	return nil
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
	// A failed interactive operation may still have a headed browser.
	b.gate.RLock()
	if b.interactive {
		b.gate.RUnlock()
		b.gate.Lock()
		var modeErr error
		if b.interactive {
			b.stopRuntime()
			b.interactive = false
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
	prepared := slot.ctx != nil
	if !prepared {
		b.authMu.Lock()
		err := b.start(ctx, false)
		if err == nil {
			err = b.preparePage(ctx, slot)
		}
		b.authMu.Unlock()
		if err != nil {
			if slot.ctx != nil {
				b.reset(slot)
			}
			return err
		}
	}
	op, cancel := operationContext(slot.ctx, ctx)
	defer func() { cancel() }()
	var err error
	if prepared {
		err = b.home(op)
		var failure *domain.Error
		if errors.As(err, &failure) && failure.Reason == "authentication-required" && ctx.Err() == nil {
			cancel()
			b.authMu.Lock()
			err = b.authenticatePage(ctx, slot)
			b.authMu.Unlock()
			if err == nil {
				op, cancel = operationContext(slot.ctx, ctx)
			}
		}
	}
	if err == nil {
		err = use(op)
	}
	if err != nil {
		b.reset(slot)
	}
	return err
}

// Give each worker its own LMS session before it serves a request. Later
// requests only navigate that worker back to HOME.
func (b *Browser) preparePage(ctx context.Context, slot *pageSlot) error {
	if err := b.createPage(ctx, slot); err != nil {
		if slot.ctx != nil {
			b.reset(slot)
		}
		return err
	}
	err := b.authenticatePage(ctx, slot)
	if err != nil {
		b.reset(slot)
	}
	return err
}

func (b *Browser) authenticatePage(ctx context.Context, slot *pageSlot) error {
	op, cancel := operationContext(slot.ctx, ctx)
	defer cancel()
	return cd.Run(op, cd.ActionFunc(func(tab context.Context) error {
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
		// SSO can rotate its cookies. Publish the latest state to the profile.
		return b.copySSO(tab, id, "")
	}))
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
