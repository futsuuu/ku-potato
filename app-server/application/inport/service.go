// Package inport defines the HTTP application's features without infrastructure requirements.
package inport

import (
	"context"
	"io"

	"github.com/futsuuu/ku-potato/app-server/application/authentication"
	"github.com/futsuuu/ku-potato/app-server/application/operation"
	"github.com/futsuuu/ku-potato/app-server/domain"
)

// StatusObserver receives job status updates until the request completes.
type StatusObserver func(operation.OperationStatus) error

type File struct {
	Content  io.ReadSeekCloser
	Metadata domain.SavedFile
}

// Authentication contains user-initiated credential acquisition and status.
type Authentication interface {
	CachedLMSAuthentication(context.Context) (authentication.AuthState, error)
	Login(context.Context, bool, StatusObserver) (authentication.AuthState, error)
	RegisterWebAuthn(context.Context, bool, StatusObserver) (domain.RegistrationResult, error)
	WebAuthnRegistrationStatus(context.Context) (domain.RegistrationResult, error)
	DeleteWebAuthn(context.Context, StatusObserver) (domain.RegistrationResult, error)
	CheckLMSAuthentication(context.Context, StatusObserver) (authentication.AuthState, error)
	CachedGoogleAuthentication(context.Context) (authentication.AuthState, error)
	GoogleLogin(context.Context, bool, StatusObserver) (authentication.AuthState, error)
	CheckGoogleAuthentication(context.Context, StatusObserver) (authentication.AuthState, error)
}

type Content interface {
	Courses(context.Context, string, StatusObserver) ([]domain.Course, error)
	Materials(context.Context, string, string, StatusObserver) (domain.CourseMaterials, error)
	Assignments(context.Context, []string, string, StatusObserver) (domain.AssignmentsResult, error)
	Detail(context.Context, string, string, StatusObserver) (domain.Detail, error)
	Download(context.Context, string, string, StatusObserver) (domain.DownloadResult, error)
	File(context.Context, string, string) (File, error)
	OpenResource(context.Context, string, string) error
}

// Service is the combined HTTP API surface; individual callers can depend on
// the narrower inbound contracts without leaking credential material.
type Service interface {
	Authentication
	Content
}
