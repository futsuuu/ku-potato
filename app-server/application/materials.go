package application

import (
	"context"
	"errors"
	"sync"

	"github.com/futsuuu/ku-potato/app-server/application/operation"
	"github.com/futsuuu/ku-potato/app-server/domain"
)

func (a *Application) parallelMaterials(ctx context.Context, ids []string) (domain.MaterialsResult, error) {
	ctx, cancel := context.WithCancelCause(ctx)
	defer cancel(nil)
	type outcome struct {
		materials *domain.CourseMaterials
		failure   *domain.CourseFailure
	}
	outcomes := make([]outcome, len(ids))
	work := make(chan int, len(ids))
	for i := range ids {
		work <- i
	}
	close(work)
	var progressMu sync.Mutex
	completed := 0
	report(ctx, operation.Progress{Stage: "fetching-materials", Total: len(ids)})
	finish := func(id string) {
		progressMu.Lock()
		defer progressMu.Unlock()
		completed++
		report(ctx, operation.Progress{Stage: "fetching-materials", Completed: completed, Total: len(ids), CourseID: id})
	}
	var workers sync.WaitGroup
	for range min(a.workers, len(ids)) {
		workers.Go(func() {
			for i := range work {
				if ctx.Err() != nil {
					return
				}
				id := ids[i]
				snapshot, err := a.content.Materials(ctx, id)
				if err == nil {
					_, err = a.append(ctx, snapshot)
				}
				if err != nil {
					var failure *domain.Error
					if ctx.Err() != nil {
						return
					}
					if errors.As(err, &failure) && failure.Reason == "authentication-required" {
						cancel(err)
						return
					}
					outcomes[i].failure = &domain.CourseFailure{CourseID: id, Error: *publicError(err)}
					finish(id)
					continue
				}
				materials, err := a.archive.Materials(ctx, id)
				if err != nil {
					cancel(err)
					return
				}
				outcomes[i].materials = &materials
				finish(id)
			}
		})
	}
	workers.Wait()
	result := domain.MaterialsResult{CourseMaterials: []domain.CourseMaterials{}, Failures: []domain.CourseFailure{}}
	if err := context.Cause(ctx); err != nil {
		return result, err
	}
	for _, outcome := range outcomes {
		if outcome.materials != nil {
			result.CourseMaterials = append(result.CourseMaterials, *outcome.materials)
		}
		if outcome.failure != nil {
			result.Failures = append(result.Failures, *outcome.failure)
		}
	}
	return result, nil
}
