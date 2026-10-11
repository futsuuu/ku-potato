package outport

import (
	"context"
	"io"

	"github.com/futsuuu/ku-potato/server/domain"
)

type Source interface {
	Login(context.Context, bool) error
	Logout(context.Context) error
	Register(context.Context, bool) error
	Status(context.Context) (bool, error)
	Courses(context.Context) (domain.CourseListing, error)
	Materials(context.Context, string) (domain.Snapshot, error)
	Resources(context.Context, string, string) (domain.Snapshot, error)
	Download(context.Context, string, string, string) (domain.Download, error)
}
type Archive interface {
	Courses(context.Context) ([]domain.Course, error)
	Materials(context.Context, string) (domain.CourseMaterials, error)
	Detail(context.Context, string) (domain.Detail, error)
	FindCourse(context.Context, string) (string, error)
	Append(context.Context, domain.Snapshot) (domain.ObservationIDs, error)
	Acquired(context.Context, string, string, int64, *domain.SavedFile, error) error
}
type AuthenticationState interface {
	Auth(context.Context) (domain.AuthState, error)
	SetAuth(context.Context, string) error
}
type Queue interface {
	Observe(context.Context, string, func(domain.Job) error) error
	Progress(context.Context, domain.Job, domain.Progress) error
	Enqueue(context.Context, domain.Request) (domain.Job, error)
	Claim(context.Context) (*domain.Job, error)
	Finish(context.Context, domain.Job, any, error) error
}
type Files interface {
	Save(string, string) (domain.SavedFile, error)
	Open(domain.SavedFile) (io.ReadSeekCloser, error)
	Remove(domain.SavedFile) error
	Discard(string) error
}
