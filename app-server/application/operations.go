package application

import (
	"context"
	"errors"

	"github.com/futsuuu/ku-potato/app-server/application/authentication"
	"github.com/futsuuu/ku-potato/app-server/application/inport"
	"github.com/futsuuu/ku-potato/app-server/application/operation"
	"github.com/futsuuu/ku-potato/app-server/domain"
)

func submitAndObserve[T any](ctx context.Context, a *Application, request operation.Request, progress inport.StatusObserver) (result T, err error) {
	e, err := a.start(ctx, request)
	if err != nil {
		return result, err
	}
	for {
		a.activeMu.Lock()
		status, changed, done, value, failure := e.status, e.changed, e.done, e.result, e.err
		a.activeMu.Unlock()
		if done {
			if failure != nil {
				return result, publicError(failure)
			}
			return value.(T), nil
		}
		if progress != nil {
			if err := progress(status); err != nil {
				return result, err
			}
		}
		select {
		case <-ctx.Done():
			return result, ctx.Err()
		case <-changed:
		}
	}
}

func loadOrSynchronize[T any](policy string, load func() (T, error), synchronize func() (T, error)) (zero T, err error) {
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

func (a *Application) Courses(ctx context.Context, policy string, p inport.StatusObserver) ([]domain.Course, error) {
	return loadOrSynchronize(policy, func() ([]domain.Course, error) { return a.archive.Courses(ctx) }, func() ([]domain.Course, error) {
		return submitAndObserve[[]domain.Course](ctx, a, operation.Request{Kind: "sync-courses"}, p)
	})
}
func (a *Application) Materials(ctx context.Context, id, policy string, p inport.StatusObserver) (domain.CourseMaterials, error) {
	return loadOrSynchronize(policy, func() (domain.CourseMaterials, error) { return a.archive.Materials(ctx, id) }, func() (domain.CourseMaterials, error) {
		result, err := submitAndObserve[domain.MaterialsResult](ctx, a, operation.Request{Kind: "sync-materials", CourseIDs: []string{id}}, p)
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
func (a *Application) Detail(ctx context.Context, id, policy string, p inport.StatusObserver) (domain.Detail, error) {
	return loadOrSynchronize(policy, func() (domain.Detail, error) { return a.archive.Detail(ctx, id) }, func() (domain.Detail, error) {
		return submitAndObserve[domain.Detail](ctx, a, operation.Request{Kind: "sync-resources", MaterialID: id}, p)
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
func (a *Application) Assignments(ctx context.Context, ids []string, policy string, p inport.StatusObserver) (domain.AssignmentsResult, error) {
	return loadOrSynchronize(policy, func() (domain.AssignmentsResult, error) {
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
		result, err := submitAndObserve[domain.MaterialsResult](ctx, a, operation.Request{Kind: "sync-materials", CourseIDs: ids}, p)
		return assignments(result.CourseMaterials, result.Failures), err
	})
}
func (a *Application) Login(ctx context.Context, interactive bool, p inport.StatusObserver) (authentication.AuthState, error) {
	return submitAndObserve[authentication.AuthState](ctx, a, operation.Request{Kind: "login", Interactive: interactive}, p)
}
func (a *Application) WebAuthnRegistrationStatus(ctx context.Context) (domain.RegistrationResult, error) {
	return a.lmsAuth.WebAuthnRegistrationStatus(ctx)
}
func (a *Application) DeleteWebAuthn(ctx context.Context, p inport.StatusObserver) (domain.RegistrationResult, error) {
	return submitAndObserve[domain.RegistrationResult](ctx, a, operation.Request{Kind: "delete-webauthn"}, p)
}
func (a *Application) CheckLMSAuthentication(ctx context.Context, p inport.StatusObserver) (authentication.AuthState, error) {
	return submitAndObserve[authentication.AuthState](ctx, a, operation.Request{Kind: "auth-check"}, p)
}
func (a *Application) RegisterWebAuthn(ctx context.Context, interactive bool, p inport.StatusObserver) (domain.RegistrationResult, error) {
	return submitAndObserve[domain.RegistrationResult](ctx, a, operation.Request{Kind: "register-webauthn", Interactive: interactive}, p)
}
func (a *Application) Download(ctx context.Context, material, resource string, p inport.StatusObserver) (domain.DownloadResult, error) {
	return submitAndObserve[domain.DownloadResult](ctx, a, operation.Request{Kind: "download-resource", MaterialID: material, ResourceID: resource}, p)
}

type progressKey struct{}

func withProgress(ctx context.Context, emit func(operation.Progress)) context.Context {
	return context.WithValue(ctx, progressKey{}, emit)
}
func report(ctx context.Context, p operation.Progress) {
	if emit, ok := ctx.Value(progressKey{}).(func(operation.Progress)); ok {
		emit(p)
	}
}
