package browser

import (
	"context"
	"errors"
	"log/slog"
	"os"
	"path/filepath"
	"sync"

	"github.com/chromedp/cdproto/cdp"
	"github.com/chromedp/cdproto/network"
	cd "github.com/chromedp/chromedp"
	workerproto "github.com/futsuuu/ku-potato/browser-worker/protocol"
)

type Options struct {
	StateDir    string
	ProfileDir  string
	CacheDir    string
	DownloadDir string
	Executable  string
	Logger      *slog.Logger
	LMSURL      string
	SSOURL      string
	Parallelism int
}

type pageSlot struct {
	ctx    context.Context
	cancel context.CancelFunc
}

type Browser struct {
	opts         Options
	gate         sync.RWMutex
	sessionMu    sync.Mutex
	root         context.Context
	cancelRoot   context.CancelFunc
	cancelAlloc  context.CancelFunc
	closeProcess func()
	closed       bool
	slots        []*pageSlot
	available    chan *pageSlot
	sso          ssoCookieSource
}

type ssoCookieSource interface {
	SSOCookies(context.Context) ([]*network.CookieParam, error)
	RenewSSOCookies(context.Context) ([]*network.CookieParam, error)
}

func (b *Browser) UseCookieSource(source ssoCookieSource) { b.sso = source }

func New(opts Options) (*Browser, error) {
	if opts.Logger == nil {
		opts.Logger = slog.Default()
	}
	if opts.ProfileDir == "" {
		opts.ProfileDir = filepath.Join(opts.StateDir, "profile")
	}
	for _, path := range []*string{&opts.StateDir, &opts.CacheDir, &opts.DownloadDir} {
		if *path == "" {
			return nil, errors.New("state, cache and download directories are required")
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
	if opts.Parallelism == 0 {
		opts.Parallelism = 4
	}
	if opts.Parallelism < 1 || opts.Parallelism > 32 {
		return nil, errors.New("parallelism must be between 1 and 32")
	}
	b := &Browser{opts: opts, available: make(chan *pageSlot, opts.Parallelism)}
	for range opts.Parallelism {
		slot := &pageSlot{}
		b.slots = append(b.slots, slot)
		b.available <- slot
	}
	return b, nil
}

func sourceError(ctx context.Context, err error) error {
	if ctx.Err() != nil {
		return ctx.Err()
	}
	if err == nil {
		return nil
	}
	var known *Failure
	if errors.As(err, &known) {
		return err
	}
	return Fail(
		workerproto.FailureReason_FAILURE_REASON_SOURCE,
		"ブラウザ操作に失敗しました。ページ構造、Chrome の起動設定、通信状態を確認してください。",
	)
}

func executor(ctx context.Context) context.Context {
	return cdp.WithExecutor(ctx, cd.FromContext(ctx).Target)
}
