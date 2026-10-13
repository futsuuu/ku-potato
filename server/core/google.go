package core

import (
	"context"
	"errors"
	"log/slog"

	"github.com/futsuuu/ku-potato/server/core/inport"
	"github.com/futsuuu/ku-potato/server/domain"
)

func (a *Application) GoogleAuth(ctx context.Context) (domain.AuthState, error) {
	if a.googleState == nil {
		return domain.AuthState{Status: "unknown"}, nil
	}
	return a.googleState.Auth(ctx)
}

func (a *Application) GoogleLogin(ctx context.Context, interactive bool, p inport.Progress) (domain.AuthState, error) {
	return runOperation[domain.AuthState](ctx, a, domain.Request{Kind: "google-login", Interactive: interactive}, p)
}

func (a *Application) GoogleCheckAuth(ctx context.Context, p inport.Progress) (domain.AuthState, error) {
	return runOperation[domain.AuthState](ctx, a, domain.Request{Kind: "google-auth-check"}, p)
}

func (a *Application) executeGoogle(ctx context.Context, r domain.Request) (result any, err error) {
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
		report(ctx, domain.Progress{Stage: "authenticating"})
		err = a.google.Login(ctx, r.Interactive)
	case "google-auth-check":
		report(ctx, domain.Progress{Stage: "authenticating"})
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
