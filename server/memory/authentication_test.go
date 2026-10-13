package memory

import (
	"context"
	"testing"
)

func TestAuthenticationStateIsProcessLocalAndProviderIndependent(t *testing.T) {
	ctx := context.Background()
	school := NewAuthenticationState()
	google := NewAuthenticationState()
	if state, err := school.Auth(ctx); err != nil || state.Status != "unknown" || state.CheckedAt != nil {
		t.Fatal(state, err)
	}
	if err := school.SetAuth(ctx, "authenticated"); err != nil {
		t.Fatal(err)
	}
	if state, err := school.Auth(ctx); err != nil || state.Status != "authenticated" || state.CheckedAt == nil {
		t.Fatal(state, err)
	}
	if state, err := google.Auth(ctx); err != nil || state.Status != "unknown" {
		t.Fatal(state, err)
	}
	if err := school.SetAuth(ctx, "unauthenticated"); err != nil {
		t.Fatal(err)
	}
	if state, err := school.Auth(ctx); err != nil || state.Status != "unauthenticated" {
		t.Fatal(state, err)
	}
	if state, err := NewAuthenticationState().Auth(ctx); err != nil || state.Status != "unknown" {
		t.Fatal(state, err)
	}
	if err := school.SetAuth(ctx, "unknown"); err == nil {
		t.Fatal("accepted invalid persisted status")
	}
}
