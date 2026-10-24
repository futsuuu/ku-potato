// Package chromedp provides the browser-backed LMS and authentication adapters.
package chromedp

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"

	"github.com/chromedp/cdproto/cdp"
	"github.com/chromedp/cdproto/network"
	"github.com/chromedp/cdproto/webauthn"
	cd "github.com/chromedp/chromedp"
	"github.com/futsuuu/ku-potato/server/core/outport"
	"github.com/futsuuu/ku-potato/server/domain"
)

type Options struct {
	StateDir    string
	ProfileDir  string
	CacheDir    string
	DownloadDir string
	Executable  string
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
	authMu       sync.Mutex
	root         context.Context
	cancelRoot   context.CancelFunc
	cancelAlloc  context.CancelFunc
	closeProcess func()
	interactive  bool
	closed       bool
	slots        []*pageSlot
	available    chan *pageSlot
	sso          ssoCookieSource
	drive        *Drive
}

var _ outport.ContentSource = (*Browser)(nil)

type ssoCookieSource interface {
	SSOCookies(context.Context) ([]*network.CookieParam, error)
}

// UseSSOCookies is configured before browser operations begin. Both browser
// instances must own distinct profiles; only scoped cookie values cross over.
func (b *Browser) UseSSOCookies(authentication *LMSAuthenticator) error {
	if authentication == nil {
		return errors.New("authentication browser is required")
	}
	workProfile, authProfile := filepath.Clean(b.opts.ProfileDir), filepath.Clean(authentication.opts.ProfileDir)
	if authentication.Browser == b || workProfile == authProfile || (runtime.GOOS == "windows" && strings.EqualFold(workProfile, authProfile)) {
		return errors.New("authentication and content profiles must be different")
	}
	if b.opts.SSOURL != authentication.opts.SSOURL || b.opts.LMSURL != authentication.opts.LMSURL {
		return errors.New("authentication and content sites must match")
	}
	b.sso = authentication
	return nil
}

func (b *Browser) UseDriveCookies(provider DriveCookieSource) {
	b.drive = &Drive{cookies: provider}
}

func New(opts Options) (*Browser, error) {
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
		if err := os.MkdirAll(*path, 0700); err != nil {
			return nil, err
		}
	}
	profile, err := filepath.Abs(opts.ProfileDir)
	if err != nil {
		return nil, err
	}
	opts.ProfileDir = profile
	if err := os.MkdirAll(filepath.Dir(profile), 0700); err != nil {
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

type credentials struct {
	Version     int                    `json:"version"`
	Username    string                 `json:"username"`
	Credentials []*webauthn.Credential `json:"credentials"`
}

func (b *Browser) credentialPath() string { return filepath.Join(b.opts.StateDir, "webauthn.json") }
func (b *Browser) WebAuthnRegistrationStatus(ctx context.Context) (domain.RegistrationResult, error) {
	b.authMu.Lock()
	defer b.authMu.Unlock()
	if err := ctx.Err(); err != nil {
		return domain.RegistrationResult{}, err
	}
	stored, err := b.loadCredentials()
	return domain.RegistrationResult{Registered: stored != nil}, err
}
func (b *Browser) DeleteWebAuthn(ctx context.Context) error {
	b.authMu.Lock()
	defer b.authMu.Unlock()
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := os.Remove(b.credentialPath()); err != nil && !os.IsNotExist(err) {
		return domain.Fail("authentication-storage", "WebAuthn認証情報を削除できません。")
	}
	return nil
}
func (b *Browser) loadCredentials() (*credentials, error) {
	body, err := os.ReadFile(b.credentialPath())
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, domain.Fail("authentication-storage", "認証情報を読み込めません。")
	}
	var stored credentials
	if json.Unmarshal(body, &stored) != nil || stored.Version != 1 || stored.Username == "" || len(stored.Credentials) == 0 {
		return nil, domain.Fail("authentication-storage", "保存済みのWebAuthn認証情報が不正です。")
	}
	for _, c := range stored.Credentials {
		if c == nil || len(c.CredentialID) == 0 || len(c.PrivateKey) == 0 || c.RpID == "" {
			return nil, domain.Fail("authentication-storage", "保存済みのWebAuthn認証情報が不正です。")
		}
	}
	return &stored, nil
}
func atomicJSON(path string, value any) error {
	body, err := json.Marshal(value)
	if err != nil {
		return err
	}
	file, err := os.CreateTemp(filepath.Dir(path), ".credential-*")
	if err != nil {
		return err
	}
	defer os.Remove(file.Name())
	defer file.Close()
	if err = file.Chmod(0600); err != nil {
		return err
	}
	if _, err = file.Write(body); err != nil {
		return err
	}
	if err = file.Sync(); err != nil {
		return err
	}
	if err = file.Close(); err != nil {
		return err
	}
	return os.Rename(file.Name(), path)
}
func newAuthenticator(ctx context.Context, stored *credentials) (webauthn.AuthenticatorID, error) {
	if err := webauthn.Enable().Do(ctx); err != nil {
		return "", err
	}
	id, err := webauthn.AddVirtualAuthenticator(&webauthn.VirtualAuthenticatorOptions{
		Protocol: webauthn.AuthenticatorProtocolCtap2, Transport: webauthn.AuthenticatorTransportUsb,
		HasResidentKey: true, HasUserVerification: true, IsUserVerified: true, AutomaticPresenceSimulation: true,
	}).Do(ctx)
	if err != nil {
		return "", err
	}
	if stored != nil {
		for _, credential := range stored.Credentials {
			if err = webauthn.AddCredential(id, credential).Do(ctx); err != nil {
				return "", err
			}
		}
	}
	return id, nil
}
func (b *Browser) saveCredentials(ctx context.Context, id webauthn.AuthenticatorID, username string) error {
	items, err := webauthn.GetCredentials(id).Do(ctx)
	if err != nil {
		return domain.Fail("authentication-storage", "WebAuthn認証情報を取得できません。")
	}
	if len(items) == 0 {
		return domain.Fail("authentication-storage", "WebAuthn認証情報が生成されていません。")
	}
	if err = atomicJSON(b.credentialPath(), credentials{Version: 1, Username: username, Credentials: items}); err != nil {
		return domain.Fail("authentication-storage", "WebAuthn認証情報を保存できません。")
	}
	return nil
}
func sourceError(ctx context.Context, err error) error {
	if err == nil {
		return nil
	}
	var known *domain.Error
	if errors.As(err, &known) {
		return err
	}
	if ctx.Err() != nil {
		return ctx.Err()
	}
	// CDP diagnostics can include page contents or credential material.
	return domain.Fail("source", "ブラウザ操作に失敗しました。ページ構造、Chrome の起動設定、通信状態を確認してください。")
}
func executor(ctx context.Context) context.Context {
	return cdp.WithExecutor(ctx, cd.FromContext(ctx).Target)
}
