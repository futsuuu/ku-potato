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
	b, err := New(Options{
		StateDir: root, ProfileDir: filepath.Join(root, "user-profile"),
		CacheDir: filepath.Join(root, "cache"), DownloadDir: filepath.Join(root, "downloads"),
	})
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
	if b.credentialPath() != filepath.Join(root, "auth", "kogakuin", "webauthn.json") {
		t.Fatalf("unexpected credential path: %s", b.credentialPath())
	}
	if err := os.MkdirAll(filepath.Dir(b.credentialPath()), 0700); err != nil {
		t.Fatal(err)
	}
	stored := credentials{
		Version: 1, Username: "student",
		Credentials: []*webauthn.Credential{{CredentialID: "AQ==", PrivateKey: "Ag==", RpID: "example.com"}},
	}
	if err := atomicJSON(b.credentialPath(), stored); err != nil {
		t.Fatal(err)
	}
	worker, err := New(Options{
		StateDir: root, ProfileDir: filepath.Join(root, "worker-profile"),
		CacheDir: filepath.Join(root, "worker-cache"), DownloadDir: filepath.Join(root, "worker-downloads"),
	})
	if err != nil {
		t.Fatal(err)
	}
	defer worker.Close()
	if err := worker.UseSSOCookies(NewLMSAuthenticator(b)); err != nil {
		t.Fatal(err)
	}
	if stored, err := worker.loadCredentials(); err != nil || stored != nil {
		t.Fatal("worker read the authentication credential", err)
	}
	workerState, err := worker.WebAuthnRegistrationStatus(context.Background())
	if err != nil || workerState.Registered {
		t.Fatal("worker sees the authentication credential", workerState, err)
	}
	if err := worker.DeleteWebAuthn(context.Background()); err != nil {
		t.Fatal(err)
	}
	if err := worker.RegisterWebAuthn(context.Background(), false); err == nil {
		t.Fatal("worker was allowed to register an authentication credential")
	}
	if _, err := os.Stat(b.credentialPath()); err != nil {
		t.Fatal("worker deleted the authentication credential", err)
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
