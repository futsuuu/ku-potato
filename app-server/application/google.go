package application

import (
	"context"
	"errors"
	"log/slog"

	"github.com/futsuuu/ku-potato/app-server/application/authentication"
	"github.com/futsuuu/ku-potato/app-server/application/inport"
	"github.com/futsuuu/ku-potato/app-server/application/operation"
	"github.com/futsuuu/ku-potato/app-server/domain"
)

func (a *Application) CachedGoogleAuthentication(
	ctx context.Context,
) (authentication.AuthState, error) {
	if a.googleState == nil {
		return authentication.AuthState{Status: "unknown"}, nil
	}
	return a.googleState.Auth(ctx)
}

func (a *Application) GoogleLogin(
	ctx context.Context,
	interactive bool,
	p inport.StatusObserver,
) (authentication.AuthState, error) {
	return submitAndObserve[authentication.AuthState](
		ctx,
		a,
		operation.Request{Kind: "google-login", Interactive: interactive},
		p,
	)
}

func (a *Application) CheckGoogleAuthentication(
	ctx context.Context,
	p inport.StatusObserver,
) (authentication.AuthState, error) {
	return submitAndObserve[authentication.AuthState](
		ctx,
		a,
		operation.Request{Kind: "google-auth-check"},
		p,
	)
}

func (a *Application) executeGoogle(
	ctx context.Context,
	r operation.Request,
) (result any, err error) {
	if a.google == nil || a.googleState == nil {
		return nil, domain.Fail("source", "Google認証が設定されていません。")
	}
	defer func() {
		var failure *domain.Error
		if errors.As(err, &failure) && failure.Reason == "authentication-required" {
			if e := a.googleState.SetAuth(ctx, "unauthenticated"); e != nil {
				slog.Error("persist Google authentication state", "error", e)
			}
		}
	}()
	status := "authenticated"
	switch r.Kind {
	case "google-login":
		report(ctx, operation.Progress{Stage: "authenticating"})
		err = a.google.Login(ctx, r.Interactive)
	case "google-auth-check":
		report(ctx, operation.Progress{Stage: "authenticating"})
		var authenticated bool
		authenticated, err = a.google.Status(ctx)
		if !authenticated {
			status = "unauthenticated"
		}
	}
	if err != nil {
		return nil, err
	}
	if err = a.googleState.SetAuth(ctx, status); err != nil {
		return nil, err
	}
	return a.googleState.Auth(ctx)
}
