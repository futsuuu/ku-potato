package httpapi

import (
	"context"
	"net/http"

	"github.com/danielgtaylor/huma/v2"
	"github.com/futsuuu/ku-potato/server/core/inport"
	"github.com/futsuuu/ku-potato/server/domain"
)

func (h *Handler) registerGoogle(api huma.API) {
	register(api, huma.Operation{OperationID: "getCachedGoogleAuthenticationState", Method: http.MethodGet, Path: "/auth/google", Summary: "Read cached Google authentication state"}, func(ctx context.Context, input *struct{}) (*dataResponse[domain.AuthState], error) {
		state, err := h.service.GoogleAuth(ctx)
		return &dataResponse[domain.AuthState]{Body: dataBody[domain.AuthState]{Data: state}}, failure(err)
	})
	registerStream(api, huma.Operation{OperationID: "googleLogin", Method: http.MethodPost, Path: "/auth/google/login", Summary: "Log in to Google and save the session"}, func(ctx context.Context, input *AuthInput, p inport.Progress) (domain.AuthState, error) {
		return h.service.GoogleLogin(ctx, input.Body.Interactive, p)
	})
	registerStream(api, huma.Operation{OperationID: "checkGoogleAuthentication", Method: http.MethodPost, Path: "/auth/google/check", Summary: "Check the saved Google session"}, func(ctx context.Context, input *struct{}, p inport.Progress) (domain.AuthState, error) {
		return h.service.GoogleCheckAuth(ctx, p)
	})
}
