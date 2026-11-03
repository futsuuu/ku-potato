package browserauth

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"

	"github.com/chromedp/cdproto/webauthn"
	"github.com/futsuuu/ku-potato/app-server/domain"
)

type credentials struct {
	Version     int                    `json:"version"`
	Username    string                 `json:"username"`
	Credentials []*webauthn.Credential `json:"credentials"`
}

func (b *Browser) credentialPath() string {
	return filepath.Join(b.opts.StateDir, "auth", "kogakuin", "webauthn.json")
}

func (b *Browser) WebAuthnRegistrationStatus(
	ctx context.Context,
) (domain.RegistrationResult, error) {
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
	if json.Unmarshal(body, &stored) != nil || stored.Version != 1 || stored.Username == "" ||
		len(stored.Credentials) == 0 {
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
	if err = file.Chmod(0o600); err != nil {
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
		Protocol:                    webauthn.AuthenticatorProtocolCtap2,
		Transport:                   webauthn.AuthenticatorTransportUsb,
		HasResidentKey:              true,
		HasUserVerification:         true,
		IsUserVerified:              true,
		AutomaticPresenceSimulation: true,
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

func (b *Browser) saveCredentials(
	ctx context.Context,
	id webauthn.AuthenticatorID,
	username string,
) error {
	items, err := webauthn.GetCredentials(id).Do(ctx)
	if err != nil {
		return domain.Fail("authentication-storage", "WebAuthn認証情報を取得できません。")
	}
	if len(items) == 0 {
		return domain.Fail("authentication-storage", "WebAuthn認証情報が生成されていません。")
	}
	if err = os.MkdirAll(filepath.Dir(b.credentialPath()), 0o700); err != nil {
		return domain.Fail("authentication-storage", "WebAuthn認証情報を保存できません。")
	}
	if err = atomicJSON(
		b.credentialPath(),
		credentials{Version: 1, Username: username, Credentials: items},
	); err != nil {
		return domain.Fail("authentication-storage", "WebAuthn認証情報を保存できません。")
	}
	return nil
}
