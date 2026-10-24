package tests

import (
	"context"
	"path/filepath"
	"reflect"
	"sync/atomic"
	"testing"
	"time"

	"github.com/futsuuu/ku-potato/server/core"
	"github.com/futsuuu/ku-potato/server/core/outport"
	"github.com/futsuuu/ku-potato/server/domain"
	"github.com/futsuuu/ku-potato/server/memory"
	"github.com/futsuuu/ku-potato/server/sqlite"
)

type courseSource struct {
	outport.ContentSource
	courses []domain.Course
}

type placementSource struct {
	outport.ContentSource
	calls atomic.Int32
}

func (s *placementSource) Courses(context.Context) (domain.CourseListing, error) {
	return domain.CourseListing{AcademicYear: 2026, Courses: []domain.Course{
		{ID: "KOG1", Availability: "available"}, {ID: "KOG1", Availability: "available"},
	}}, nil
}

func (s *placementSource) Materials(context.Context, string) (domain.Snapshot, error) {
	s.calls.Add(1)
	return domain.Snapshot{Materials: &domain.CourseMaterials{CourseID: "KOG1", Folders: []domain.Folder{{Materials: []domain.Material{{ID: "REP1", Type: "report"}}}}}}, nil
}

func TestCoursePlacementsDoNotDuplicateMaterialSyncOrAssignments(t *testing.T) {
	store, err := sqlite.Open(filepath.Join(t.TempDir(), "archive.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	source := &placementSource{}
	app := core.New(source, store, memory.NewAuthenticationState(), memory.NewQueue(), nil, time.Second, 2)
	done := make(chan error, 1)
	go func() { done <- app.Run(ctx) }()
	t.Cleanup(func() {
		cancel()
		if err := <-done; err != nil {
			t.Error(err)
		}
	})
	synced, err := app.Assignments(ctx, nil, "true", nil)
	if err != nil || len(synced.Assignments) != 1 || source.calls.Load() != 1 {
		t.Fatal(synced, source.calls.Load(), err)
	}
	cached, err := app.Assignments(ctx, nil, "false", nil)
	if err != nil || len(cached.Assignments) != 1 || source.calls.Load() != 1 {
		t.Fatal(cached, source.calls.Load(), err)
	}
	courses, err := store.Courses(ctx)
	if err != nil || len(courses) != 2 {
		t.Fatal(courses, err)
	}
}

func (s courseSource) Courses(context.Context) (domain.CourseListing, error) {
	return domain.CourseListing{AcademicYear: 2026, Courses: s.courses}, nil
}

func TestCourseSyncReturnsRetainedHistory(t *testing.T) {
	old := domain.Course{ID: "KOG1", Name: "past course", Availability: "available", AcademicYear: 2026, Type: "unknown"}
	current := domain.Course{ID: "KOG2", Name: "updated course", Availability: "available", AcademicYear: 2026, Type: "unknown"}
	archived := old
	archived.Archived = true
	for _, test := range []struct {
		name    string
		current []domain.Course
		want    []domain.Course
	}{
		{name: "current and past", current: []domain.Course{current}, want: []domain.Course{current, archived}},
		{name: "empty current list", current: []domain.Course{}, want: []domain.Course{archived}},
	} {
		t.Run(test.name, func(t *testing.T) {
			store, err := sqlite.Open(filepath.Join(t.TempDir(), "archive.sqlite"))
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = store.Close() })
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			previous := []domain.Course{old}
			if len(test.current) > 0 {
				previous = append(previous, domain.Course{ID: current.ID, Name: "previous name", Availability: "available", AcademicYear: 2026, Type: "unknown"})
			}
			if _, err := store.Append(ctx, domain.Snapshot{AcademicYear: 2026, Courses: previous}); err != nil {
				t.Fatal(err)
			}
			app := core.New(courseSource{courses: test.current}, store, memory.NewAuthenticationState(), memory.NewQueue(), nil, time.Second, 1)
			done := make(chan error, 1)
			go func() { done <- app.Run(ctx) }()
			t.Cleanup(func() {
				cancel()
				if err := <-done; err != nil {
					t.Error(err)
				}
			})
			synced, err := app.Courses(ctx, "true", nil)
			if err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(synced, test.want) {
				t.Fatalf("sync result = %#v, want %#v", synced, test.want)
			}
			cached, err := app.Courses(ctx, "false", nil)
			if err != nil || !reflect.DeepEqual(synced, cached) {
				t.Fatalf("sync result differs from saved list: synced=%#v cached=%#v err=%v", synced, cached, err)
			}
		})
	}
}
