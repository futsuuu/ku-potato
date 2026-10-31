package authstate

import (
	"context"
	"sync"

	"github.com/futsuuu/ku-potato/app-server/application/authentication"
	"github.com/futsuuu/ku-potato/app-server/application/outport"
	"github.com/futsuuu/ku-potato/app-server/domain"
)

type AuthenticationState struct {
	mu    sync.RWMutex
	state authentication.AuthState
}

var _ outport.AuthenticationState = (*AuthenticationState)(nil)

func NewAuthenticationState() *AuthenticationState {
	return &AuthenticationState{state: authentication.AuthState{Status: "unknown"}}
}

func (s *AuthenticationState) Auth(ctx context.Context) (authentication.AuthState, error) {
	if err := ctx.Err(); err != nil {
		return authentication.AuthState{}, err
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.state, nil
}

func (s *AuthenticationState) SetAuth(ctx context.Context, status string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if status != "authenticated" && status != "unauthenticated" {
		return domain.Fail("invalid-input", "認証状態が不正です。")
	}
	s.mu.Lock()
	s.state = authentication.AuthState{Status: status}
	s.mu.Unlock()
	return nil
}
