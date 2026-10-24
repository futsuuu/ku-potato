package httpapi

import (
	"context"
	"net/http"

	"github.com/danielgtaylor/huma/v2"
	"github.com/futsuuu/ku-potato/server/core/authentication"
	"github.com/futsuuu/ku-potato/server/core/inport"
)

func (h *Handler) registerGoogle(api huma.API) {
	register(api, huma.Operation{OperationID: "getCachedGoogleAuthenticationState", Method: http.MethodGet, Path: "/auth/google", Summary: "Read cached Google authentication state"}, func(ctx context.Context, input *struct{}) (*dataResponse[authentication.AuthState], error) {
		state, err := h.service.CachedGoogleAuthentication(ctx)
		return &dataResponse[authentication.AuthState]{Body: dataBody[authentication.AuthState]{Data: state}}, failure(err)
	})
	registerStream(api, huma.Operation{OperationID: "googleLogin", Method: http.MethodPost, Path: "/auth/google/login", Summary: "Log in to Google and save the session"}, func(ctx context.Context, input *AuthInput, p inport.StatusObserver) (authentication.AuthState, error) {
		return h.service.GoogleLogin(ctx, input.Body.Interactive, p)
	})
	registerStream(api, huma.Operation{OperationID: "checkGoogleAuthentication", Method: http.MethodPost, Path: "/auth/google/check", Summary: "Check the saved Google session"}, func(ctx context.Context, input *struct{}, p inport.StatusObserver) (authentication.AuthState, error) {
		return h.service.CheckGoogleAuthentication(ctx, p)
	})
}
