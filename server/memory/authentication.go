package memory

import (
	"context"
	"sync"
	"time"

	"github.com/futsuuu/ku-potato/server/core/outport"
	"github.com/futsuuu/ku-potato/server/domain"
)

type AuthenticationState struct {
	mu    sync.RWMutex
	state domain.AuthState
}

var _ outport.AuthenticationState = (*AuthenticationState)(nil)

func NewAuthenticationState() *AuthenticationState {
	return &AuthenticationState{state: domain.AuthState{Status: "unknown"}}
}

func (s *AuthenticationState) Auth(ctx context.Context) (domain.AuthState, error) {
	if err := ctx.Err(); err != nil {
		return domain.AuthState{}, err
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	state := s.state
	if state.CheckedAt != nil {
		checkedAt := *state.CheckedAt
		state.CheckedAt = &checkedAt
	}
	return state, nil
}

func (s *AuthenticationState) SetAuth(ctx context.Context, status string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if status != "authenticated" && status != "unauthenticated" {
		return domain.Fail("invalid-input", "認証状態が不正です。")
	}
	now := time.Now().UTC()
	s.mu.Lock()
	s.state = domain.AuthState{Status: status, CheckedAt: &now}
	s.mu.Unlock()
	return nil
}
