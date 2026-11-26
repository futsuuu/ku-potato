package browser

import (
	"context"
	"errors"
	"log/slog"
	"os"
	"path/filepath"
	"sync"

	"github.com/chromedp/cdproto/cdp"
	cd "github.com/chromedp/chromedp"
)

type Options struct {
	StateDir   string
	ProfileDir string
	CacheDir   string
	Executable string
	Logger     *slog.Logger
	LMSURL     string
	SSOURL     string
}
type Browser struct {
	opts                Options
	authMu              sync.Mutex
	root                context.Context
	page                context.Context
	cancelPage          context.CancelFunc
	cancelRoot          context.CancelFunc
	cancelAlloc         context.CancelFunc
	closeProcess        func()
	cookiesReady        bool
	defaultContext      cdp.BrowserContextID
	defaultWindowOpened bool
	interactive         bool
	closed              bool
}

func New(opts Options) (*Browser, error) {
	if opts.Logger == nil {
		opts.Logger = slog.Default()
	}
	if opts.ProfileDir == "" {
		opts.ProfileDir = filepath.Join(opts.StateDir, "profile")
	}
	for _, path := range []*string{&opts.StateDir, &opts.CacheDir} {
		if *path == "" {
			return nil, errors.New("state and cache directories are required")
		}
		absolute, err := filepath.Abs(*path)
		if err != nil {
			return nil, err
		}
		*path = absolute
		if err := os.MkdirAll(*path, 0o700); err != nil {
			return nil, err
		}
	}
	profile, err := filepath.Abs(opts.ProfileDir)
	if err != nil {
		return nil, err
	}
	opts.ProfileDir = profile
	if err := os.MkdirAll(filepath.Dir(profile), 0o700); err != nil {
		return nil, err
	}
	if opts.LMSURL == "" {
		opts.LMSURL = "https://study.ns.kogakuin.ac.jp"
	}
	if opts.SSOURL == "" {
		opts.SSOURL = "https://slink.secioss.com"
	}
	return &Browser{opts: opts}, nil
}

func sourceError(ctx context.Context, err error) error {
	if err == nil {
		return nil
	}
	if ctx.Err() != nil {
		return ctx.Err()
	}
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return err
	}
	if _, ok := errors.AsType[*Error](err); ok {
		return err
	}
	// CDP diagnostics can include page contents or credential material.
	return Fail("source", "ブラウザ操作に失敗しました。ページ構造、Chrome の起動設定、通信状態を確認してください。")
}

func executor(ctx context.Context) context.Context {
	return cdp.WithExecutor(ctx, cd.FromContext(ctx).Target)
}
