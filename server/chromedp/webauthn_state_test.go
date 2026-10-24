package chromedp

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/chromedp/cdproto/webauthn"
)

func TestDeletingWebAuthnKeepsSharedProfile(t *testing.T) {
	root := t.TempDir()
	b, err := New(Options{StateDir: filepath.Join(root, "auth", "kogakuin"), ProfileDir: filepath.Join(root, "profile"), CacheDir: filepath.Join(root, "cache"), DownloadDir: filepath.Join(root, "downloads")})
	if err != nil {
		t.Fatal(err)
	}
	defer b.Close()
	if err := os.MkdirAll(b.opts.ProfileDir, 0700); err != nil {
		t.Fatal(err)
	}
	profileFile := filepath.Join(b.opts.ProfileDir, "retained")
	if err := os.WriteFile(profileFile, []byte("profile"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := atomicJSON(b.credentialPath(), credentials{Version: 1, Username: "student", Credentials: []*webauthn.Credential{{CredentialID: "AQ==", PrivateKey: "Ag==", RpID: "example.com"}}}); err != nil {
		t.Fatal(err)
	}
	state, err := b.WebAuthnRegistrationStatus(context.Background())
	if err != nil || !state.Registered {
		t.Fatal("saved WebAuthn credential not found", state, err)
	}
	if err := b.DeleteWebAuthn(context.Background()); err != nil {
		t.Fatal(err)
	}
	state, err = b.WebAuthnRegistrationStatus(context.Background())
	if err != nil || state.Registered {
		t.Fatal("WebAuthn credential remained", state, err)
	}
	if _, err := os.Stat(profileFile); err != nil {
		t.Fatal("shared profile was removed", err)
	}
	if err := b.DeleteWebAuthn(context.Background()); err != nil {
		t.Fatal("repeat deletion failed", err)
	}
}
