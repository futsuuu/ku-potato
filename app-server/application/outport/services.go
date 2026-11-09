package outport

import (
	"context"
	"io"

	"github.com/futsuuu/ku-potato/app-server/application/authentication"
	"github.com/futsuuu/ku-potato/app-server/domain"
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

// ContentSource retrieves LMS content and its linked resources.
type ContentSource interface {
	Courses(context.Context) (domain.CourseListing, error)
	Materials(context.Context, string) (domain.Snapshot, error)
	Resources(context.Context, string, string) (domain.Snapshot, error)
	Download(context.Context, string, string, string) (Download, error)
}

type ExternalDownloader interface {
	Key(string) (string, bool)
	Download(context.Context, string) (string, string, error)
}

type Archive interface {
	Courses(context.Context) ([]domain.Course, error)
	Materials(context.Context, string) (domain.CourseMaterials, error)
	Detail(context.Context, string) (domain.Detail, error)
	FindCourse(context.Context, string) (string, error)
	Append(context.Context, domain.Snapshot) (RetrievalIDs, error)
	// SavedFile reads the current saved file without assembling a material detail.
	SavedFile(context.Context, string, string) (domain.SavedFile, error)
	// ReferencesContent reports whether any current resource uses this content hash.
	ReferencesContent(ctx context.Context, contentHash string) (bool, error)
	// ReplaceSavedFile commits the new file and returns the previous file.
	// Check ReferencesContent before removing its shared content.
	// retrievalID must identify the resource list used for this download.
	ReplaceSavedFile(
		ctx context.Context,
		material, resource string,
		retrievalID string,
		file domain.SavedFile,
	) (*domain.SavedFile, error)
}
type AuthenticationState interface {
	Auth(context.Context) (authentication.AuthState, error)
	SetAuth(context.Context, string) error
}

type ResourceMaterializer interface {
	Prepare(context.Context, io.Reader, domain.SavedFile) (string, error)
}

type Files interface {
	Save(sourcePath, originalFilename string) (domain.SavedFile, error)
	Open(file domain.SavedFile) (io.ReadSeekCloser, error)
	Remove(contentHash string) error
	Discard(downloadPath string) error
}
