package outport

import (
	"context"
	"io"

	"github.com/futsuuu/ku-potato/server/core/authentication"
	"github.com/futsuuu/ku-potato/server/core/operation"
	"github.com/futsuuu/ku-potato/server/domain"
)

type Authentication interface {
	Login(context.Context, bool) error
	Status(context.Context) (bool, error)
}

// LMSAuthentication manages LMS login and WebAuthn credentials.
type LMSAuthentication interface {
	Authentication
	// RegisterWebAuthn registers and saves a credential through the SSO browser.
	RegisterWebAuthn(context.Context, bool) error
	// WebAuthnRegistrationStatus reads whether a credential is saved locally.
	WebAuthnRegistrationStatus(context.Context) (domain.RegistrationResult, error)
	DeleteWebAuthn(context.Context) error
}

// ContentSource fetches LMS content and its linked resources.
type ContentSource interface {
	Courses(context.Context) (domain.CourseListing, error)
	Materials(context.Context, string) (domain.Snapshot, error)
	Resources(context.Context, string, string) (domain.Snapshot, error)
	// The final argument is an archived external URL, used only speculatively.
	Download(context.Context, string, string, string, string) (Download, error)
}
type Archive interface {
	Courses(context.Context) ([]domain.Course, error)
	Materials(context.Context, string) (domain.CourseMaterials, error)
	Detail(context.Context, string) (domain.Detail, error)
	FindCourse(context.Context, string) (string, error)
	Append(context.Context, domain.Snapshot) (ObservationIDs, error)
	Acquired(context.Context, string, string, int64, *domain.SavedFile, error) error
}
type AuthenticationState interface {
	Auth(context.Context) (authentication.AuthState, error)
	SetAuth(context.Context, string) error
}
type Queue interface {
	Observe(context.Context, string, func(operation.Job) error) error
	Progress(context.Context, operation.Job, operation.Progress) error
	Enqueue(context.Context, operation.Request) (operation.Job, error)
	Claim(context.Context) (*operation.Job, error)
	Finish(context.Context, operation.Job, any, error) error
}
type Files interface {
	Save(string, string) (domain.SavedFile, error)
	Open(domain.SavedFile) (io.ReadSeekCloser, error)
	Remove(domain.SavedFile) error
	Discard(string) error
}
