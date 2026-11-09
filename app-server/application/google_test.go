package application

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/futsuuu/ku-potato/app-server/application/authentication"
	"github.com/futsuuu/ku-potato/app-server/application/operation"
	"github.com/futsuuu/ku-potato/app-server/application/outport"
	"github.com/futsuuu/ku-potato/app-server/domain"
)

type googleAuthentication struct {
	outport.Authentication
	err         error
	loggedIn    bool
	interactive bool
}

type providerDownloadSource struct {
	outport.ContentSource
	err error
}

func (s providerDownloadSource) Download(
	context.Context,
	string,
	string,
	string,
) (outport.Download, error) {
	return outport.Download{
		Snapshot: domain.Snapshot{
			MaterialID: "SRY1",
			Resources:  []domain.RetrievedResource{{ID: "SRS1", Type: "external"}},
		},
	}, s.err
}

type providerDownloadArchive struct{ outport.Archive }

func (providerDownloadArchive) FindCourse(context.Context, string) (string, error) {
	return "KOG1", nil
}

func (providerDownloadArchive) Detail(context.Context, string) (domain.Detail, error) {
	return domain.Detail{}, domain.ErrMissing
}

func (providerDownloadArchive) Append(
	context.Context,
	domain.Snapshot,
) (outport.ObservationIDs, error) {
	return outport.ObservationIDs{Resources: 1}, nil
}

func (providerDownloadArchive) Acquired(
	context.Context,
	string,
	string,
	int64,
	*domain.SavedFile,
	error,
) error {
	return nil
}

func TestExternalDownloadAuthenticationFailureKeepsLMSSession(t *testing.T) {
	for _, test := range []struct {
		name        string
		err         error
		lms, google string
	}{
		{"google-expired", &outport.AuthenticationError{Provider: "google", Err: domain.Fail("authentication-required", "Google login required")}, "authenticated", "unauthenticated"},
		{"lms-expired", domain.Fail("authentication-required", "LMS login required"), "unauthenticated", "authenticated"},
		{"network", domain.Fail("source", "network failed"), "authenticated", "authenticated"},
	} {
		t.Run(test.name, func(t *testing.T) {
			lms := &savedAuthentication{status: "authenticated"}
			google := &savedAuthentication{status: "authenticated"}
			app := New(
				providerDownloadSource{err: test.err},
				providerDownloadArchive{},
				lms,
				nil,
				time.Second,
				1,
				WithGoogle(&googleAuthentication{}, google),
			)
			_, err := app.executeJob(
				context.Background(),
				operation.Request{
					Kind:       "download-resource",
					MaterialID: "SRY1",
					ResourceID: "SRS1",
				},
			)
			if !errors.Is(err, test.err) || lms.status != test.lms || google.status != test.google {
				t.Fatal("wrong provider invalidated", err, lms, google)
			}
		})
	}
}

func (g *googleAuthentication) Login(_ context.Context, interactive bool) error {
	g.interactive = interactive
	g.loggedIn = g.err == nil
	return g.err
}
func (g *googleAuthentication) Status(context.Context) (bool, error) { return g.loggedIn, g.err }

type savedAuthentication struct{ status string }

func (s *savedAuthentication) Auth(context.Context) (authentication.AuthState, error) {
	return authentication.AuthState{Status: s.status}, nil
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
	app := New(nil, nil, lms, nil, time.Second, 1, WithGoogle(google, state))
	for _, test := range []struct{ kind, status string }{
		{"google-login", "authenticated"},
		{"google-auth-check", "authenticated"},
	} {
		request := operation.Request{Kind: test.kind, Interactive: test.kind == "google-login"}
		if err := validateJobRequest(request); err != nil {
			t.Fatal(err)
		}
		result, err := app.executeJob(ctx, request)
		if err != nil || result.(authentication.AuthState).Status != test.status ||
			state.status != test.status {
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
	if _, err := app.executeJob(ctx, operation.Request{Kind: "google-login"}); err == nil {
		t.Fatal("expired Google session was accepted")
	}
	if state.status != "unauthenticated" || lms.status != "authenticated" {
		t.Fatal("expired session changed the wrong provider", state, lms)
	}
	google.err = domain.Fail("source", "network")
	state.status = "authenticated"
	if _, err := app.executeJob(ctx, operation.Request{Kind: "google-auth-check"}); err == nil {
		t.Fatal("network failure was accepted")
	}
	if state.status != "authenticated" {
		t.Fatal("network failure erased authentication")
	}
}
