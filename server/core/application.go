package core

import (
	"context"
	"errors"
	"log/slog"
	"sync"
	"time"

	"github.com/futsuuu/ku-potato/server/core/authentication"
	"github.com/futsuuu/ku-potato/server/core/inport"
	"github.com/futsuuu/ku-potato/server/core/operation"
	"github.com/futsuuu/ku-potato/server/core/outport"
	"github.com/futsuuu/ku-potato/server/domain"
)

type Application struct {
	content     outport.ContentSource
	lmsAuth     outport.LMSAuthentication
	archive     outport.Archive
	lmsState    outport.AuthenticationState
	queue       outport.Queue
	files       outport.Files
	timeout     time.Duration
	workers     int
	auth        sync.RWMutex
	google      outport.Authentication
	googleState outport.AuthenticationState
}

type Option func(*Application)

func WithLMSAuthentication(authentication outport.LMSAuthentication) Option {
	return func(a *Application) { a.lmsAuth = authentication }
}

func WithGoogle(authentication outport.Authentication, state outport.AuthenticationState) Option {
	return func(a *Application) { a.google, a.googleState = authentication, state }
}

func New(content outport.ContentSource, archive outport.Archive, state outport.AuthenticationState, queue outport.Queue, files outport.Files, timeout time.Duration, workers int, options ...Option) *Application {
	a := &Application{content: content, archive: archive, lmsState: state, queue: queue, files: files, timeout: timeout, workers: max(1, workers)}
	// Existing single-browser clients can still supply both contracts.
	if authentication, ok := content.(outport.LMSAuthentication); ok {
		a.lmsAuth = authentication
	}
	for _, option := range options {
		option(a)
	}
	return a
}

var _ inport.Service = (*Application)(nil)

func (a *Application) CachedLMSAuthentication(ctx context.Context) (authentication.AuthState, error) {
	return a.lmsState.Auth(ctx)
}

func (a *Application) File(ctx context.Context, material, resource string) (inport.File, error) {
	detail, err := a.archive.Detail(ctx, material)
	if err != nil {
		return inport.File{}, err
	}
	for _, r := range detail.Resources {
		if r.ID == resource && r.SavedFile != nil {
			file, err := a.files.Open(*r.SavedFile)
			return inport.File{Content: file, Metadata: *r.SavedFile}, err
		}
	}
	return inport.File{}, domain.ErrMissing
}

func (a *Application) execute(ctx context.Context, r operation.Request) (result any, err error) {
	if r.Kind == "google-login" || r.Kind == "google-auth-check" {
		return a.executeGoogle(ctx, r)
	}
	defer func() {
		var e *domain.Error
		if errors.As(err, &e) && e.Reason == "authentication-required" {
			state := a.lmsState
			var provider *outport.AuthenticationError
			if errors.As(err, &provider) && provider.Provider == "google" {
				state = a.googleState
			}
			if state == nil {
				return
			}
			if authErr := state.SetAuth(ctx, "unauthenticated"); authErr != nil {
				slog.Error("persist authentication state", "error", authErr)
			}
		}
	}()
	switch r.Kind {
	case "login":
		report(ctx, operation.Progress{Stage: "authenticating"})
		err = a.lmsAuth.Login(ctx, r.Interactive)
		if err == nil {
			err = a.lmsState.SetAuth(ctx, "authenticated")
		}
		return authentication.AuthState{Status: "authenticated"}, err
	case "register-webauthn":
		report(ctx, operation.Progress{Stage: "registering"})
		err = a.lmsAuth.RegisterWebAuthn(ctx, r.Interactive)
		if err == nil {
			err = a.lmsState.SetAuth(ctx, "authenticated")
		}
		return domain.RegistrationResult{Registered: err == nil}, err
	case "delete-webauthn":
		err = a.lmsAuth.DeleteWebAuthn(ctx)
		return domain.RegistrationResult{Registered: false}, err
	case "auth-check":
		report(ctx, operation.Progress{Stage: "authenticating"})
		ok, e := a.lmsAuth.Status(ctx)
		if e != nil {
			return nil, e
		}
		status := "unauthenticated"
		if ok {
			status = "authenticated"
		}
		return authentication.AuthState{Status: status}, a.lmsState.SetAuth(ctx, status)
	case "sync-courses":
		report(ctx, operation.Progress{Stage: "fetching-courses"})
		courses, e := a.content.Courses(ctx)
		if e != nil {
			return nil, e
		}
		if _, e = a.append(ctx, domain.Snapshot{AcademicYear: courses.AcademicYear, Courses: courses.Courses}); e != nil {
			return nil, e
		}
		return a.archive.Courses(ctx)
	case "sync-materials":
		report(ctx, operation.Progress{Stage: "fetching-courses"})
		ids := r.CourseIDs
		if len(ids) == 0 {
			courses, e := a.content.Courses(ctx)
			if e != nil {
				if ctx.Err() != nil {
					return nil, ctx.Err()
				}
				return nil, e
			}
			if _, e = a.append(ctx, domain.Snapshot{AcademicYear: courses.AcademicYear, Courses: courses.Courses}); e != nil {
				return nil, e
			}
			seen := map[string]bool{}
			for _, c := range courses.Courses {
				if c.Availability == "available" && !seen[c.ID] {
					seen[c.ID] = true
					ids = append(ids, c.ID)
				}
			}
		}
		return a.parallelMaterials(ctx, ids)
	case "sync-resources":
		report(ctx, operation.Progress{Stage: "fetching-resources"})
		preferred, e := a.archive.FindCourse(ctx, r.MaterialID)
		if e != nil {
			return nil, e
		}
		snapshot, e := a.content.Resources(ctx, r.MaterialID, preferred)
		if e != nil {
			return nil, e
		}
		if _, e = a.append(ctx, snapshot); e != nil {
			return nil, e
		}
		return a.archive.Detail(ctx, r.MaterialID)
	case "download-resource":
		return a.download(ctx, r)
	}
	return nil, domain.Fail("invalid-input", "unknown job kind")
}
func (a *Application) append(ctx context.Context, s domain.Snapshot) (outport.ObservationIDs, error) {
	ids, err := a.archive.Append(ctx, s)
	if err != nil {
		return outport.ObservationIDs{}, err
	}
	return ids, a.lmsState.SetAuth(ctx, "authenticated")
}
func publicError(err error) *domain.Error {
	var e *domain.Error
	if errors.As(err, &e) {
		return e
	}
	if errors.Is(err, domain.ErrMissing) {
		return &domain.Error{Reason: "archive-data-missing", Message: "保存済みデータがありません。"}
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return &domain.Error{Reason: "timeout", Message: "処理がタイムアウトしました。"}
	}
	return &domain.Error{Reason: "internal", Message: "処理に失敗しました。サーバログを確認してください。"}
}
