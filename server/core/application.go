package core

import (
	"context"
	"errors"
	"log/slog"
	"regexp"
	"sync"
	"time"

	"github.com/futsuuu/ku-potato/server/core/inport"
	"github.com/futsuuu/ku-potato/server/core/outport"
	"github.com/futsuuu/ku-potato/server/domain"
)

type Application struct {
	source      outport.Source
	identity    outport.Identity
	archive     outport.Archive
	state       outport.AuthenticationState
	queue       outport.Queue
	files       outport.Files
	timeout     time.Duration
	workers     int
	auth        sync.RWMutex
	google      outport.Authentication
	googleState outport.AuthenticationState
}

type Option func(*Application)

func WithIdentity(identity outport.Identity) Option {
	return func(a *Application) { a.identity = identity }
}

func WithGoogle(authentication outport.Authentication, state outport.AuthenticationState) Option {
	return func(a *Application) { a.google, a.googleState = authentication, state }
}

func New(source outport.Source, archive outport.Archive, state outport.AuthenticationState, queue outport.Queue, files outport.Files, timeout time.Duration, workers int, options ...Option) *Application {
	a := &Application{source: source, archive: archive, state: state, queue: queue, files: files, timeout: timeout, workers: max(1, workers)}
	// Existing single-browser clients can still supply both contracts.
	if identity, ok := source.(outport.Identity); ok {
		a.identity = identity
	}
	for _, option := range options {
		option(a)
	}
	return a
}

var _ inport.Service = (*Application)(nil)

func (a *Application) Auth(ctx context.Context) (domain.AuthState, error) { return a.state.Auth(ctx) }

var materialID = regexp.MustCompile(`^[A-Z]+\d+$`)
var resourceID = regexp.MustCompile(`^SRS\d+$`)

func (a *Application) submit(ctx context.Context, r domain.Request) (domain.Job, error) {
	if err := validate(r); err != nil {
		return domain.Job{}, err
	}
	seen := map[string]bool{}
	ids := []string{}
	for _, id := range r.CourseIDs {
		if !seen[id] {
			seen[id] = true
			ids = append(ids, id)
		}
	}
	r.CourseIDs = ids
	return a.queue.Enqueue(ctx, r)
}
func validate(r domain.Request) error {
	for _, id := range r.CourseIDs {
		if len(id) == 0 || len(id) > 200 {
			return domain.Fail("invalid-input", "invalid course ID")
		}
	}
	if len(r.CourseIDs) > 500 {
		return domain.Fail("invalid-input", "too many courses")
	}
	switch r.Kind {
	case "login", "auth-check", "register-webauthn", "delete-webauthn", "google-login", "google-auth-check", "sync-courses", "sync-materials":
	case "sync-resources", "download-resource":
		if !materialID.MatchString(r.MaterialID) {
			return domain.Fail("invalid-input", "invalid material ID")
		}
	default:
		return domain.Fail("invalid-input", "unknown job kind")
	}
	if r.Kind == "download-resource" && !resourceID.MatchString(r.ResourceID) {
		return domain.Fail("invalid-input", "invalid resource ID")
	}
	if r.Interactive && r.Kind != "login" && r.Kind != "google-login" && r.Kind != "register-webauthn" {
		return domain.Fail("invalid-input", "interaction is only available for authentication jobs")
	}
	if len(r.CourseIDs) > 0 && r.Kind != "sync-materials" {
		return domain.Fail("invalid-input", "courseIds is only available for sync-materials")
	}
	if r.MaterialID != "" && r.Kind != "sync-resources" && r.Kind != "download-resource" {
		return domain.Fail("invalid-input", "materialId is not valid for this job")
	}
	if r.ResourceID != "" && r.Kind != "download-resource" {
		return domain.Fail("invalid-input", "resourceId is only available for download-resource")
	}
	return nil
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
		jobCtx = withProgress(jobCtx, func(p domain.Progress) {
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

func (a *Application) executeJob(ctx context.Context, r domain.Request) (any, error) {
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
func (a *Application) execute(ctx context.Context, r domain.Request) (result any, err error) {
	if r.Kind == "google-login" || r.Kind == "google-auth-check" {
		return a.executeGoogle(ctx, r)
	}
	defer func() {
		var e *domain.Error
		if errors.As(err, &e) && e.Reason == "authentication-required" {
			state := a.state
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
		report(ctx, domain.Progress{Stage: "authenticating"})
		err = a.identity.Login(ctx, r.Interactive)
		if err == nil {
			err = a.state.SetAuth(ctx, "authenticated")
		}
		return domain.AuthState{Status: "authenticated"}, err
	case "register-webauthn":
		report(ctx, domain.Progress{Stage: "registering"})
		err = a.identity.Register(ctx, r.Interactive)
		if err == nil {
			err = a.state.SetAuth(ctx, "authenticated")
		}
		return domain.RegistrationResult{Registered: err == nil}, err
	case "delete-webauthn":
		err = a.identity.DeleteWebAuthn(ctx)
		return domain.RegistrationResult{Registered: false}, err
	case "auth-check":
		report(ctx, domain.Progress{Stage: "authenticating"})
		ok, e := a.identity.Status(ctx)
		if e != nil {
			return nil, e
		}
		status := "unauthenticated"
		if ok {
			status = "authenticated"
		}
		return domain.AuthState{Status: status}, a.state.SetAuth(ctx, status)
	case "sync-courses":
		report(ctx, domain.Progress{Stage: "fetching-courses"})
		courses, e := a.source.Courses(ctx)
		if e != nil {
			return nil, e
		}
		if _, e = a.append(ctx, domain.Snapshot{AcademicYear: courses.AcademicYear, Courses: courses.Courses}); e != nil {
			return nil, e
		}
		return a.archive.Courses(ctx)
	case "sync-materials":
		report(ctx, domain.Progress{Stage: "fetching-courses"})
		ids := r.CourseIDs
		if len(ids) == 0 {
			courses, e := a.source.Courses(ctx)
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
		report(ctx, domain.Progress{Stage: "fetching-resources"})
		preferred, e := a.archive.FindCourse(ctx, r.MaterialID)
		if e != nil {
			return nil, e
		}
		snapshot, e := a.source.Resources(ctx, r.MaterialID, preferred)
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
func (a *Application) append(ctx context.Context, s domain.Snapshot) (domain.ObservationIDs, error) {
	ids, err := a.archive.Append(ctx, s)
	if err != nil {
		return domain.ObservationIDs{}, err
	}
	return ids, a.state.SetAuth(ctx, "authenticated")
}
func (a *Application) download(ctx context.Context, r domain.Request) (any, error) {
	preferred, err := a.archive.FindCourse(ctx, r.MaterialID)
	if err != nil {
		return nil, err
	}
	cachedURL := ""
	cached, err := a.archive.Detail(ctx, r.MaterialID)
	if err != nil && !errors.Is(err, domain.ErrMissing) {
		return nil, err
	}
	for _, resource := range cached.Resources {
		if resource.ID == r.ResourceID && resource.Type == "external" {
			cachedURL = resource.URL
			break
		}
	}
	report(ctx, domain.Progress{Stage: "downloading"})
	download, err := a.source.Download(ctx, r.MaterialID, r.ResourceID, preferred, cachedURL)
	if download.Path != "" {
		defer func() {
			if e := a.files.Discard(download.Path); e != nil {
				slog.Error("discard download", "error", e)
			}
		}()
	}
	var observations domain.ObservationIDs
	if download.Snapshot.MaterialID != "" {
		var e error
		if observations, e = a.append(ctx, download.Snapshot); e != nil {
			return nil, e
		}
	}
	if err != nil {
		if e := a.archive.Acquired(ctx, r.MaterialID, r.ResourceID, observations.Resources, nil, err); e != nil {
			slog.Error("record acquisition failure", "error", e)
		}
		return nil, err
	}
	if download.URL != "" {
		return domain.DownloadResult{Type: "external", URL: download.URL}, a.archive.Acquired(ctx, r.MaterialID, r.ResourceID, observations.Resources, nil, nil)
	}
	report(ctx, domain.Progress{Stage: "saving"})
	file, err := a.files.Save(download.Path, download.Filename)
	if err != nil {
		return nil, err
	}
	detail, err := a.archive.Detail(ctx, r.MaterialID)
	if err != nil {
		_ = a.files.Remove(file)
		return nil, err
	}
	var previous *domain.SavedFile
	for _, res := range detail.Resources {
		if res.ID == r.ResourceID {
			previous = res.SavedFile
		}
	}
	if err = a.archive.Acquired(ctx, r.MaterialID, r.ResourceID, observations.Resources, &file, nil); err != nil {
		_ = a.files.Remove(file)
		return nil, err
	}
	if previous != nil && previous.ID != file.ID {
		if e := a.files.Remove(*previous); e != nil {
			slog.Error("remove superseded resource", "error", e)
		}
	}
	return domain.DownloadResult{Type: "file", File: &file, DownloadURL: "/materials/" + r.MaterialID + "/resources/" + r.ResourceID + "/file"}, nil
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
