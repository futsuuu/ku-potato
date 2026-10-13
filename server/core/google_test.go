package core

import (
	"context"
	"testing"
	"time"

	"github.com/futsuuu/ku-potato/server/core/outport"
	"github.com/futsuuu/ku-potato/server/domain"
)

type googleAuthentication struct {
	outport.Authentication
	err         error
	loggedIn    bool
	interactive bool
}

func (g *googleAuthentication) Login(_ context.Context, interactive bool) error {
	g.interactive = interactive
	g.loggedIn = g.err == nil
	return g.err
}
func (g *googleAuthentication) Status(context.Context) (bool, error) { return g.loggedIn, g.err }

type savedAuthentication struct{ status string }

func (s *savedAuthentication) Auth(context.Context) (domain.AuthState, error) {
	return domain.AuthState{Status: s.status}, nil
}
func (s *savedAuthentication) SetAuth(_ context.Context, status string) error {
	s.status = status
	return nil
}

func TestGoogleOperationsUseTheirOwnAuthenticationState(t *testing.T) {
	ctx := context.Background()
	lms := &savedAuthentication{status: "authenticated"}
	state := &savedAuthentication{status: "unknown"}
	google := &googleAuthentication{}
	app := New(nil, nil, lms, nil, nil, time.Second, 1, WithGoogle(google, state))
	for _, test := range []struct{ kind, status string }{
		{"google-login", "authenticated"},
		{"google-auth-check", "authenticated"},
	} {
		request := domain.Request{Kind: test.kind, Interactive: test.kind == "google-login"}
		if err := validate(request); err != nil {
			t.Fatal(err)
		}
		result, err := app.executeJob(ctx, request)
		if err != nil || result.(domain.AuthState).Status != test.status || state.status != test.status {
			t.Fatal(test, result, err)
		}
		if lms.status != "authenticated" {
			t.Fatal("Google operation changed LMS state", test)
		}
	}
	if !google.interactive {
		t.Fatal("interactive login was not forwarded")
	}
	google.err = domain.Fail("authentication-required", "expired")
	state.status = "authenticated"
	if _, err := app.executeJob(ctx, domain.Request{Kind: "google-login"}); err == nil {
		t.Fatal("expired Google session was accepted")
	}
	if state.status != "unauthenticated" || lms.status != "authenticated" {
		t.Fatal("expired session changed the wrong provider", state, lms)
	}
	google.err = domain.Fail("source", "network")
	state.status = "authenticated"
	if _, err := app.executeJob(ctx, domain.Request{Kind: "google-auth-check"}); err == nil {
		t.Fatal("network failure was accepted")
	}
	if state.status != "authenticated" {
		t.Fatal("network failure erased authentication")
	}
}
