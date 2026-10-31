package browserauth

import (
	"context"
	"errors"
	"time"

	"github.com/chromedp/cdproto/cdp"
	"github.com/chromedp/cdproto/target"
	"github.com/chromedp/cdproto/webauthn"
	cd "github.com/chromedp/chromedp"
	"github.com/futsuuu/ku-potato/app-server/domain"
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

func (b *Browser) stopRuntime() {
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
	b.authMu.Lock()
	defer b.authMu.Unlock()
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
	closeProcess, err := processlifetime.BindToParent(cd.FromContext(b.root).Browser.Process())
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
	b.authMu.Lock()
	defer b.authMu.Unlock()
	return sourceError(ctx, b.runProviderAuth(ctx, interactive, dedicated, google, use))
}

func (b *Browser) runProviderAuth(ctx context.Context, interactive, dedicated, google bool, use func(context.Context) error) error {
	if ctx.Err() != nil {
		return ctx.Err()
	}
	if b.root != nil && b.root.Err() != nil {
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
	}
	return err
}

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
