package core

import (
	"context"
	"log/slog"
	"time"

	"github.com/futsuuu/ku-potato/server/core/operation"
)

// Run owns bounded workers; authentication is an exclusive barrier.
func (a *Application) Run(ctx context.Context) error {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	results := make(chan error, a.workers)
	for range a.workers {
		go func() { results <- a.work(ctx) }()
	}
	var result error
	for range a.workers {
		if err := <-results; err != nil && result == nil {
			result = err
			cancel()
		}
	}
	return result
}

func (a *Application) work(ctx context.Context) error {
	for {
		if ctx.Err() != nil {
			return nil
		}
		job, err := a.queue.Claim(ctx)
		if err != nil {
			if ctx.Err() != nil {
				return nil
			}
			return err
		}
		if job == nil {
			select {
			case <-ctx.Done():
				return nil
			case <-time.After(100 * time.Millisecond):
			}
			continue
		}
		duration := a.timeout
		if job.Request.Interactive {
			duration = 10 * time.Minute
		}
		jobCtx, cancel := context.WithTimeout(ctx, duration)
		jobCtx = withProgress(jobCtx, func(p operation.Progress) {
			if err := a.queue.Progress(jobCtx, *job, p); err != nil && jobCtx.Err() == nil {
				slog.Error("update operation progress", "error", err)
			}
		})
		result, runErr := a.executeJob(jobCtx, job.Request)
		cancel()
		if ctx.Err() != nil {
			return nil
		}
		if runErr != nil {
			slog.Warn("job operation failed", "jobId", job.ID, "kind", job.Request.Kind, "error", runErr)
		}
		if err := a.queue.Finish(ctx, *job, result, runErr); err != nil {
			return err
		}
	}
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
