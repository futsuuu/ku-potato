// Package inport defines the HTTP application's features without infrastructure requirements.
package inport

import (
	"context"
	"io"

	"github.com/futsuuu/ku-potato/server/domain"
)

type Progress func(domain.OperationStatus) error

type File struct {
	Content  io.ReadSeekCloser
	Metadata domain.SavedFile
}

// Authentication contains user-initiated credential acquisition and status.
type Authentication interface {
	Auth(context.Context) (domain.AuthState, error)
	Login(context.Context, bool, Progress) (domain.AuthState, error)
	Register(context.Context, bool, Progress) (domain.RegistrationResult, error)
	WebAuthn(context.Context) (domain.RegistrationResult, error)
	DeleteWebAuthn(context.Context, Progress) (domain.RegistrationResult, error)
	CheckAuth(context.Context, Progress) (domain.AuthState, error)
	GoogleAuth(context.Context) (domain.AuthState, error)
	GoogleLogin(context.Context, bool, Progress) (domain.AuthState, error)
	GoogleCheckAuth(context.Context, Progress) (domain.AuthState, error)
}

type Content interface {
	Courses(context.Context, string, Progress) ([]domain.Course, error)
	Materials(context.Context, string, string, Progress) (domain.CourseMaterials, error)
	Assignments(context.Context, []string, string, Progress) (domain.AssignmentsResult, error)
	Detail(context.Context, string, string, Progress) (domain.Detail, error)
	Download(context.Context, string, string, Progress) (domain.DownloadResult, error)
	File(context.Context, string, string) (File, error)
}

// Service is the combined HTTP API surface; individual callers can depend on
// the narrower inbound contracts without leaking credential material.
type Service interface {
	Authentication
	Content
}
