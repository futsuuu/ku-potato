package browserauth

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
		CacheDir: filepath.Join(root, "cache"),
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
