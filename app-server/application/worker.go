package application

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"time"

	"github.com/futsuuu/ku-potato/app-server/application/operation"
	"github.com/futsuuu/ku-potato/app-server/domain"
)

type execution struct {
	status  operation.OperationStatus
	result  any
	err     error
	changed chan struct{}
	done    bool
}

func (a *Application) Run(ctx context.Context) error {
	stop := context.AfterFunc(ctx, a.stop)
	defer stop()
	<-ctx.Done()
	a.stop()
	return nil
}

func (a *Application) start(ctx context.Context, request operation.Request) (*execution, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if err := validateJobRequest(request); err != nil {
		return nil, err
	}
	seen := map[string]bool{}
	ids := []string{}
	for _, id := range request.CourseIDs {
		if !seen[id] {
			seen[id] = true
			ids = append(ids, id)
		}
	}
	request.CourseIDs = ids
	key, _ := json.Marshal(request)
	a.activeMu.Lock()
	if current := a.active[string(key)]; current != nil {
		a.activeMu.Unlock()
		return current, nil
	}
	e := &execution{status: operation.OperationStatus{Status: "running", Attempt: 1, Progress: &operation.Progress{Stage: "waiting"}}, changed: make(chan struct{})}
	a.active[string(key)] = e
	a.activeMu.Unlock()
	go func() {
		duration := a.timeout
		if request.Interactive {
			duration = 10 * time.Minute
		}
		jobCtx, cancel := context.WithTimeout(a.background, duration)
		jobCtx = withProgress(jobCtx, func(progress operation.Progress) {
			a.activeMu.Lock()
			e.status.Progress = &progress
			close(e.changed)
			e.changed = make(chan struct{})
			a.activeMu.Unlock()
		})
		result, runErr := a.executeJob(jobCtx, request)
		cancel()
		if runErr != nil {
			slog.Warn("operation failed", "kind", request.Kind, "error", runErr)
		}
		a.activeMu.Lock()
		e.result, e.err, e.done = result, runErr, true
		e.status.Status = "succeeded"
		if runErr != nil {
			e.status.Status = "failed"
			var failure *domain.Error
			if errors.As(runErr, &failure) && failure.Reason == "authentication-required" {
				e.status.Status = "blocked"
			}
		}
		delete(a.active, string(key))
		close(e.changed)
		a.activeMu.Unlock()
	}()
	return e, nil
}

func (a *Application) executeJob(ctx context.Context, r operation.Request) (any, error) {
	switch r.Kind {
	case "login", "auth-check", "register-webauthn", "delete-webauthn", "google-login", "google-auth-check":
		a.auth.Lock()
		defer a.auth.Unlock()
	default:
		a.auth.RLock()
		defer a.auth.RUnlock()
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return a.execute(ctx, r)
}
