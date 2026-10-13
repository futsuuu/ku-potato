package httpapi

import (
	"context"
	"net/http"
	"strings"
	"testing"

	"github.com/futsuuu/ku-potato/server/core/inport"
	"github.com/futsuuu/ku-potato/server/domain"
)

type googleService struct {
	inport.Service
	request domain.Request
}

func (s *googleService) GoogleAuth(context.Context) (domain.AuthState, error) {
	return domain.AuthState{Status: "unknown"}, nil
}
func (s *googleService) GoogleLogin(_ context.Context, interactive bool, p inport.Progress) (domain.AuthState, error) {
	s.request = domain.Request{Kind: "google-login", Interactive: interactive}
	if err := p(domain.OperationStatus{Status: "running", Attempt: 1, Progress: &domain.Progress{Stage: "authenticating"}}); err != nil {
		return domain.AuthState{}, err
	}
	return domain.AuthState{Status: "authenticated"}, nil
}
func (s *googleService) GoogleCheckAuth(context.Context, inport.Progress) (domain.AuthState, error) {
	s.request = domain.Request{Kind: "google-auth-check"}
	return domain.AuthState{Status: "unauthenticated"}, nil
}

func TestGoogleAuthenticationEndpoints(t *testing.T) {
	service := &googleService{}
	handler := New(service, "127.0.0.1:8787")
	response := apiRequest(handler, http.MethodGet, "/auth/google", "")
	if response.Code != 200 || !strings.Contains(response.Body.String(), `"status":"unknown"`) {
		t.Fatal(response.Code, response.Body)
	}
	for _, test := range []struct{ method, path, body, kind, status string }{
		{http.MethodPost, "/auth/google/login", `{"interactive":true}`, "google-login", "authenticated"},
		{http.MethodPost, "/auth/google/check", "", "google-auth-check", "unauthenticated"},
	} {
		response := apiRequest(handler, test.method, test.path, test.body)
		if response.Code != 200 || !strings.Contains(response.Header().Get("Content-Type"), "text/event-stream") || !strings.Contains(response.Body.String(), `"status":"`+test.status+`"`) || !strings.Contains(response.Body.String(), "event: result") {
			t.Fatal(test.path, response.Code, response.Body)
		}
		if service.request.Kind != test.kind || service.request.Interactive != (test.kind == "google-login") {
			t.Fatal(test.path, service.request)
		}
	}
	response = apiRequest(handler, http.MethodPost, "/auth/google/webauthn", `{"interactive":true}`)
	if response.Code != http.StatusNotFound {
		t.Fatal("Google exposed WebAuthn registration", response.Code)
	}
}
