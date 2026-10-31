package browser

import (
	"context"
	"errors"
	"time"

	"github.com/chromedp/cdproto/cdp"
	"github.com/chromedp/cdproto/network"
	"github.com/chromedp/cdproto/storage"
	"github.com/chromedp/cdproto/target"
	cd "github.com/chromedp/chromedp"
	workerproto "github.com/futsuuu/ku-potato/browser-worker/protocol"
	"github.com/futsuuu/ku-potato/internal/processlifetime"
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

func (b *Browser) start(ctx context.Context) error {
	if b.closed {
		return errors.New("browser is closed")
	}
	if b.root != nil {
		if b.root.Err() != nil {
			return b.root.Err()
		}
		return nil
	}
	opts := append([]cd.ExecAllocatorOption{}, cd.DefaultExecAllocatorOptions[:]...)
	opts = append(opts, cd.UserDataDir(b.opts.ProfileDir), cd.Flag("disk-cache-dir", b.opts.CacheDir), cd.Flag("headless", "new"), cd.Flag("disable-dev-shm-usage", true), cd.Flag("allow-browser-signin", "false"), cd.Flag("restore-last-session", true))

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
		return Fail(workerproto.FailureReason_FAILURE_REASON_BROWSER_START, "Chrome を起動できません。KU-POTATO 用の Chrome が残っていないか、Chrome のパスと認証プロファイルの使用状況を確認してください。")
	}
	closeProcess, err := processlifetime.BindToParent(cd.FromContext(b.root).Browser.Process())
	if err != nil {
		b.stopRuntime()
		return Fail(workerproto.FailureReason_FAILURE_REASON_BROWSER_START, "Chrome のプロセス管理を設定できません。")
	}
	b.closeProcess = closeProcess
	return nil
}

func (b *Browser) copySSO(ctx context.Context, from, to cdp.BrowserContextID) error {
	exec := cdp.WithExecutor(ctx, cd.FromContext(ctx).Browser)
	cookies, err := storage.GetCookies().WithBrowserContextID(from).Do(exec)
	if err != nil {
		return err
	}
	params := ssoCookieParams(b.opts.SSOURL, cookies)
	if len(params) == 0 {
		return nil
	}
	return storage.SetCookies(params).WithBrowserContextID(to).Do(exec)
}

func (b *Browser) withPage(ctx context.Context, use func(context.Context) error) error {
	b.gate.RLock()
	err := b.usePage(ctx, use)
	crashed := err != nil && b.root != nil && b.root.Err() != nil
	b.gate.RUnlock()
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
		b.sessionMu.Lock()
		err := b.start(ctx)
		if err == nil {
			err = b.preparePage(ctx, slot)
		}
		b.sessionMu.Unlock()
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
		var failure *Failure
		if errors.As(err, &failure) && failure.Reason == workerproto.FailureReason_FAILURE_REASON_AUTHENTICATION_REQUIRED && ctx.Err() == nil {
			cancel()
			b.sessionMu.Lock()
			err = b.authenticatePage(ctx, slot)
			b.sessionMu.Unlock()
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
		err := b.session(tab)
		var failure *Failure
		if errors.As(err, &failure) && failure.Reason == workerproto.FailureReason_FAILURE_REASON_AUTHENTICATION_REQUIRED && b.sso != nil && ctx.Err() == nil {
			for _, refresh := range []func(context.Context) ([]*network.CookieParam, error){b.sso.SSOCookies, b.sso.RenewSSOCookies} {
				params, refreshErr := refresh(ctx)
				if refreshErr != nil {
					return refreshErr
				}
				if len(params) == 0 {
					return Fail(workerproto.FailureReason_FAILURE_REASON_AUTHENTICATION_REQUIRED, "統合認証システムに再ログインしてください。")
				}
				exec := cdp.WithExecutor(tab, cd.FromContext(tab).Browser)
				for _, contextID := range []cdp.BrowserContextID{"", id} {
					if err := storage.ClearCookies().WithBrowserContextID(contextID).Do(exec); err != nil {
						return err
					}
					if err := storage.SetCookies(params).WithBrowserContextID(contextID).Do(exec); err != nil {
						return err
					}
				}
				err = b.session(tab)
				if !errors.As(err, &failure) || failure.Reason != workerproto.FailureReason_FAILURE_REASON_AUTHENTICATION_REQUIRED || ctx.Err() != nil {
					break
				}
			}
		}
		if err != nil {
			return err
		}
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
