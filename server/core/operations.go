package core

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/futsuuu/ku-potato/server/core/inport"
	"github.com/futsuuu/ku-potato/server/domain"
)

// runOperation detaches observation from execution. Disconnecting one client
// does not cancel a shared operation or an in-flight credential registration.
func runOperation[T any](ctx context.Context, a *Application, request domain.Request, progress inport.Progress) (result T, err error) {
	job, err := a.submit(ctx, request)
	if err != nil {
		return result, err
	}
	var terminal domain.Job
	err = a.queue.Observe(ctx, job.ID, func(job domain.Job) error {
		status := job.Status
		if status == "queued" && job.Attempts > 0 {
			status = "retrying"
		}
		if progress != nil && job.Status != "succeeded" && job.Status != "failed" && job.Status != "blocked" {
			if err := progress(domain.OperationStatus{Status: status, Attempt: job.Attempts, Progress: job.Progress, Error: job.Error}); err != nil {
				return err
			}
		}
		terminal = job
		return nil
	})
	if err != nil {
		return result, err
	}
	if terminal.Error != nil {
		return result, terminal.Error
	}
	if err := json.Unmarshal(terminal.Result, &result); err != nil {
		return result, err
	}
	return result, nil
}

func readOperation[T any](ctx context.Context, policy string, load func() (T, error), synchronize func() (T, error)) (zero T, err error) {
	if policy != "auto" && policy != "true" && policy != "false" {
		return zero, domain.Fail("invalid-input", "sync must be auto, true, or false")
	}
	if policy != "true" {
		data, err := load()
		if err == nil {
			return data, nil
		}
		if !errors.Is(err, domain.ErrMissing) || policy == "false" {
			return zero, err
		}
	}
	return synchronize()
}

func (a *Application) Courses(ctx context.Context, policy string, p inport.Progress) ([]domain.Course, error) {
	return readOperation(ctx, policy, func() ([]domain.Course, error) { return a.archive.Courses(ctx) }, func() ([]domain.Course, error) {
		return runOperation[[]domain.Course](ctx, a, domain.Request{Kind: "sync-courses"}, p)
	})
}
func (a *Application) Materials(ctx context.Context, id, policy string, p inport.Progress) (domain.CourseMaterials, error) {
	return readOperation(ctx, policy, func() (domain.CourseMaterials, error) { return a.archive.Materials(ctx, id) }, func() (domain.CourseMaterials, error) {
		result, err := runOperation[domain.MaterialsResult](ctx, a, domain.Request{Kind: "sync-materials", CourseIDs: []string{id}}, p)
		if err != nil {
			return domain.CourseMaterials{}, err
		}
		if len(result.Failures) > 0 {
			return domain.CourseMaterials{}, &result.Failures[0].Error
		}
		if len(result.CourseMaterials) != 1 {
			return domain.CourseMaterials{}, domain.ErrMissing
		}
		return result.CourseMaterials[0], nil
	})
}
func (a *Application) Detail(ctx context.Context, id, policy string, p inport.Progress) (domain.Detail, error) {
	return readOperation(ctx, policy, func() (domain.Detail, error) { return a.archive.Detail(ctx, id) }, func() (domain.Detail, error) {
		return runOperation[domain.Detail](ctx, a, domain.Request{Kind: "sync-resources", MaterialID: id}, p)
	})
}
func assignments(materials []domain.CourseMaterials, failures []domain.CourseFailure) domain.AssignmentsResult {
	result := domain.AssignmentsResult{Assignments: []domain.Assignment{}, Failures: failures}
	for _, course := range materials {
		for _, folder := range course.Folders {
			for _, material := range folder.Materials {
				if material.Type != "material" {
					result.Assignments = append(result.Assignments, domain.Assignment{CourseID: course.CourseID, FolderName: folder.Name, Material: material})
				}
			}
		}
	}
	return result
}
func (a *Application) Assignments(ctx context.Context, ids []string, policy string, p inport.Progress) (domain.AssignmentsResult, error) {
	return readOperation(ctx, policy, func() (domain.AssignmentsResult, error) {
		selected := append([]string(nil), ids...)
		if len(selected) == 0 {
			courses, err := a.archive.Courses(ctx)
			if err != nil {
				return domain.AssignmentsResult{}, err
			}
			seen := map[string]bool{}
			for _, c := range courses {
				if c.ID != "" && !seen[c.ID] {
					seen[c.ID] = true
					selected = append(selected, c.ID)
				}
			}
		}
		materials := []domain.CourseMaterials{}
		failures := []domain.CourseFailure{}
		for _, id := range selected {
			value, err := a.archive.Materials(ctx, id)
			if errors.Is(err, domain.ErrMissing) && policy == "auto" {
				return domain.AssignmentsResult{}, err
			}
			if err != nil {
				failures = append(failures, domain.CourseFailure{CourseID: id, Error: *publicError(err)})
			} else {
				materials = append(materials, value)
			}
		}
		return assignments(materials, failures), nil
	}, func() (domain.AssignmentsResult, error) {
		result, err := runOperation[domain.MaterialsResult](ctx, a, domain.Request{Kind: "sync-materials", CourseIDs: ids}, p)
		return assignments(result.CourseMaterials, result.Failures), err
	})
}
func (a *Application) Login(ctx context.Context, interactive bool, p inport.Progress) (domain.AuthState, error) {
	return runOperation[domain.AuthState](ctx, a, domain.Request{Kind: "login", Interactive: interactive}, p)
}
func (a *Application) WebAuthn(ctx context.Context) (domain.RegistrationResult, error) {
	return a.source.WebAuthn(ctx)
}
func (a *Application) DeleteWebAuthn(ctx context.Context, p inport.Progress) (domain.RegistrationResult, error) {
	return runOperation[domain.RegistrationResult](ctx, a, domain.Request{Kind: "delete-webauthn"}, p)
}
func (a *Application) CheckAuth(ctx context.Context, p inport.Progress) (domain.AuthState, error) {
	return runOperation[domain.AuthState](ctx, a, domain.Request{Kind: "auth-check"}, p)
}
func (a *Application) Register(ctx context.Context, interactive bool, p inport.Progress) (domain.RegistrationResult, error) {
	return runOperation[domain.RegistrationResult](ctx, a, domain.Request{Kind: "register-webauthn", Interactive: interactive}, p)
}
func (a *Application) Download(ctx context.Context, material, resource string, p inport.Progress) (domain.DownloadResult, error) {
	return runOperation[domain.DownloadResult](ctx, a, domain.Request{Kind: "download-resource", MaterialID: material, ResourceID: resource}, p)
}

type progressKey struct{}

func withProgress(ctx context.Context, emit func(domain.Progress)) context.Context {
	return context.WithValue(ctx, progressKey{}, emit)
}
func report(ctx context.Context, p domain.Progress) {
	if emit, ok := ctx.Value(progressKey{}).(func(domain.Progress)); ok {
		emit(p)
	}
}
