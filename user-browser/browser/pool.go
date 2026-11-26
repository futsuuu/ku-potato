package browser

import (
	"context"
	"errors"
	"time"

	"github.com/chromedp/cdproto/cdp"
	"github.com/chromedp/cdproto/runtime"
	"github.com/chromedp/cdproto/target"
	"github.com/chromedp/cdproto/webauthn"
	cd "github.com/chromedp/chromedp"
	"github.com/futsuuu/ku-potato/internal/processlifetime"
)

// The CDP target belongs to the server lifetime. Only the operation is cancelled,
// including when the browser detaches its target after the user closes a window.
func operationContext(page, request context.Context) (context.Context, context.CancelFunc) {
	ctx, cancel := context.WithCancel(page)
	if c := cd.FromContext(page); c != nil && c.Target != nil {
		sessionID := c.Target.SessionID
		cd.ListenBrowser(ctx, func(event any) {
			if detached, ok := event.(*target.EventDetachedFromTarget); ok &&
				detached.SessionID == sessionID {
				// Listeners run on the CDP reader: signal cancellation only.
				cancel()
			}
		})
	}
	stop := context.AfterFunc(request, cancel)
	if request.Err() != nil {
		cancel()
	}
	return ctx, func() { stop(); cancel() }
}

func (b *Browser) stopRuntime() error {
	var err error
	if b.cookiesReady && b.root.Err() == nil {
		_, err = b.saveCookies()
	}
	b.discardRuntime()
	return err
}

func (b *Browser) discardRuntime() {
	if b.root != nil && b.root.Err() == nil && cd.FromContext(b.root).Browser != nil {
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
	if b.cancelPage != nil {
		b.cancelPage()
	}
	if b.cancelAlloc != nil {
		b.cancelAlloc()
	}
	b.root, b.page, b.cancelPage = nil, nil, nil
	b.cancelRoot, b.cancelAlloc = nil, nil
	b.cookiesReady = false
	b.defaultContext = ""
	b.defaultWindowOpened = false
	b.interactive = false
}

func (b *Browser) Close() error {
	b.authMu.Lock()
	defer b.authMu.Unlock()
	b.closed = true
	return b.stopRuntime()
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
		if err := b.checkAuthPages(ctx); err != nil {
			return err
		}
		if b.cookiesReady && b.interactive == interactive {
			return nil
		}
		if err := b.stopRuntime(); err != nil {
			return err
		}
	}
	opts := append([]cd.ExecAllocatorOption{}, cd.DefaultExecAllocatorOptions[:]...)
	// https://github.com/microsoft/playwright/blob/b4d016a/packages/playwright-core/src/server/chromium/chromiumSwitches.ts
	opts = append(
		opts,
		cd.UserDataDir(b.opts.ProfileDir),
		cd.Flag("allow-browser-signin", "false"),
		cd.Flag("disk-cache-dir", b.opts.CacheDir),
		cd.Flag("disable-dev-shm-usage", true),
		// Flag replaces the entire list, so retain chromedp's disabled features.
		cd.Flag(
			"disable-features",
			"site-per-process,Translate,BlinkGenPropertyTrees,msForceBrowserSignIn",
		),
		cd.Flag("disable-search-engine-choice-screen", true),
		cd.Flag("edge-skip-compat-layer-relaunch", true),
		cd.Flag("headless", !interactive),
		cd.Flag("hide-crash-restore-bubble", true),
		cd.Flag("no-service-autorun", true),
		cd.Flag("no-startup-window", true),
	)
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
	// Initialize browser-level CDP without waiting for or creating a page.
	if _, err := cd.Targets(b.root); err != nil {
		b.opts.Logger.ErrorContext(ctx, "Chrome startup failed",
			"executable", b.opts.Executable,
			"error", err,
		)
		_ = b.stopRuntime()
		if ctx.Err() != nil {
			return ctx.Err()
		}
		return Fail(
			"browser-start",
			"Chrome を起動できません。KU-POTATO 用の Chrome が残っていないか、Chrome のパスと認証プロファイルの使用状況を確認してください。",
		)
	}
	closeProcess, err := processlifetime.BindToParent(cd.FromContext(b.root).Browser.Process())
	if err != nil {
		b.opts.Logger.ErrorContext(ctx, "Chrome process management failed",
			"executable", b.opts.Executable,
			"error", err,
		)
		_ = b.stopRuntime()
		return Fail("browser-start", "Chrome のプロセス管理を設定できません。")
	}
	b.closeProcess = closeProcess
	if err := b.restoreCookies(b.root); err != nil {
		_ = b.stopRuntime()
		return err
	}
	// Failed startup must never overwrite the previous cookie snapshot.
	b.cookiesReady = true
	b.interactive = interactive
	return nil
}

type authPageKind uint8

const (
	sharedAuthPage authPageKind = iota
	dedicatedAuthPage
	isolatedAuthPage
)

// Caller holds authMu. Windowless Chrome can retain live Go contexts after
// their targets disappear, and closing its last ordinary window ends the
// default profile's session-cookie lifetime without ending the browser process.
func (b *Browser) checkAuthPages(ctx context.Context) error {
	if !b.defaultWindowOpened {
		return nil
	}
	pages, err := target.GetTargets().Do(cdp.WithExecutor(ctx, cd.FromContext(b.root).Browser))
	if err != nil {
		return err
	}
	var defaultAlive, sharedAlive bool
	for _, page := range pages {
		if page.Type != "page" || page.BrowserContextID != b.defaultContext {
			continue
		}
		defaultAlive = true
		if b.page != nil && page.TargetID == cd.FromContext(b.page).Target.TargetID {
			sharedAlive = true
		}
	}
	if !defaultAlive {
		// This jar no longer describes logout or authentication changes. Never
		// checkpoint it again; a new runtime must restore the last snapshot.
		b.cookiesReady = false
	}
	if b.page != nil && !sharedAlive {
		b.cancelPage()
		b.page, b.cancelPage = nil, nil
	}
	return nil
}

func (b *Browser) authPage(
	ctx context.Context,
	kind authPageKind,
) (context.Context, func(), error) {
	if kind == sharedAuthPage && b.page != nil {
		return b.page, func() {}, nil
	}
	root := b.root
	op, cancel := operationContext(root, ctx)
	defer cancel()
	exec := cdp.WithExecutor(op, cd.FromContext(root).Browser)
	var contextID cdp.BrowserContextID
	if kind == isolatedAuthPage {
		var err error
		contextID, err = target.CreateBrowserContext().WithDisposeOnDetach(true).Do(exec)
		if err != nil {
			return nil, nil, err
		}
	}
	dispose := func() {
		if contextID != "" && root.Err() == nil {
			cleanup, cancel := context.WithTimeout(root, 5*time.Second)
			defer cancel()
			_ = target.DisposeBrowserContext(contextID).
				Do(cdp.WithExecutor(cleanup, cd.FromContext(root).Browser))
		}
	}
	// Edge needs an explicit window for the first target in a fresh context.
	pageID, err := target.CreateTarget("about:blank").
		WithBrowserContextID(contextID).
		WithNewWindow(kind == isolatedAuthPage || !b.defaultWindowOpened).Do(exec)
	if err != nil {
		dispose()
		return nil, nil, err
	}
	page, closePage := cd.NewContext(root, cd.WithTargetID(pageID))
	cleanup := func() { dispose(); closePage() }
	// chromedp's target event loop must live as long as the page, not just
	// this initialization request. A cancelled initialization stops the runtime.
	stop := context.AfterFunc(ctx, b.cancelRoot)
	err = cd.Run(page)
	stop()
	if err != nil {
		cleanup()
		return nil, nil, err
	}
	if kind != isolatedAuthPage {
		info, err := target.GetTargetInfo().WithTargetID(pageID).Do(exec)
		if err != nil {
			cleanup()
			return nil, nil, err
		}
		b.defaultContext = info.BrowserContextID
		b.defaultWindowOpened = true
	}
	if kind == sharedAuthPage {
		b.page, b.cancelPage = page, closePage
		return page, func() {}, nil
	}
	return page, cleanup, nil
}

func (b *Browser) withAuth(
	ctx context.Context,
	interactive, dedicated bool,
	use func(context.Context, *credentials, webauthn.AuthenticatorID) error,
) error {
	return b.withSessionAuth(ctx, interactive, dedicated, func(tab context.Context) error {
		return b.authenticated(
			tab,
			func(stored *credentials, id webauthn.AuthenticatorID) error { return use(tab, stored, id) },
		)
	})
}

func (b *Browser) withSessionAuth(
	ctx context.Context,
	interactive, dedicated bool,
	use func(context.Context) error,
) error {
	kind := sharedAuthPage
	if dedicated {
		kind = dedicatedAuthPage
	}
	return b.withProviderAuth(ctx, interactive, kind, !dedicated, use)
}

func (b *Browser) withProviderAuth(
	ctx context.Context,
	interactive bool,
	kind authPageKind,
	restart bool,
	use func(context.Context) error,
) error {
	b.authMu.Lock()
	defer b.authMu.Unlock()
	return sourceError(ctx, b.runProviderAuth(ctx, interactive, kind, restart, use))
}

func (b *Browser) runProviderAuth(
	ctx context.Context,
	interactive bool,
	kind authPageKind,
	restart bool,
	use func(context.Context) error,
) error {
	if ctx.Err() != nil {
		return ctx.Err()
	}
	if b.root != nil && b.root.Err() != nil {
		_ = b.stopRuntime()
	}
	// Do not leave another provider's ordinary window beside the isolated one.
	if kind == isolatedAuthPage && b.defaultWindowOpened {
		if err := b.stopRuntime(); err != nil {
			return err
		}
	}
	if err := b.start(ctx, interactive); err != nil {
		return err
	}
	tab, closePage, err := b.authPage(ctx, kind)
	if err != nil {
		// Authentication has not run, and a closed initial window may already
		// have ended the profile session. Preserve the previous checkpoint.
		b.cookiesReady = false
		_ = b.stopRuntime()
		return err
	}
	defer closePage()
	op, cancel := operationContext(tab, ctx)
	defer cancel()
	err = cd.Run(op, cd.ActionFunc(func(tab context.Context) error {
		if err := target.ActivateTarget(cd.FromContext(tab).Target.TargetID).
			Do(cdp.WithExecutor(tab, cd.FromContext(tab).Browser)); err != nil {
			return err
		}
		if interactive {
			// New headed windows can ignore clicks before their first rendered
			// frames. Activate first: background tabs may not render at all.
			if err := cd.Run(tab, cd.Evaluate(
				`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`,
				nil,
				func(p *runtime.EvaluateParams) *runtime.EvaluateParams { return p.WithAwaitPromise(true) },
			)); err != nil {
				return err
			}
		}
		return use(tab)
	}))
	if err != nil && op.Err() != nil {
		// A closed authentication window can make CDP report a storage or
		// protocol error before returning the operation's cancellation.
		err = op.Err()
	}
	// Save even failed/cancelled operations before disposing their window.
	// Closing the last ordinary tab can end Chrome's session-cookie lifetime.
	stopRuntime := kind == dedicatedAuthPage ||
		interactive && (err == nil || kind == isolatedAuthPage)
	var saved bool
	var saveErr error
	if b.root.Err() == nil {
		saved, saveErr = b.saveCookies()
	}
	if stopRuntime {
		b.discardRuntime()
	}
	if saveErr != nil {
		if err == nil {
			err = saveErr
		} else {
			b.opts.Logger.ErrorContext(ctx, "Cookie persistence failed", "error", saveErr)
		}
	}
	if err == nil && !saved {
		// The window closed after authentication finished but before its
		// checkpoint. Let the caller retry instead of reporting a lost login.
		err = context.Canceled
	}
	if err == nil && stopRuntime && interactive && restart {
		err = b.start(ctx, false)
	}
	return err
}

func (b *Browser) authenticated(
	tab context.Context,
	use func(*credentials, webauthn.AuthenticatorID) error,
) error {
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
