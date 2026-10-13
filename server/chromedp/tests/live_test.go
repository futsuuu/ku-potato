package tests

import (
	"context"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"github.com/futsuuu/ku-potato/server/core"
	"github.com/futsuuu/ku-potato/server/domain"
	"github.com/futsuuu/ku-potato/server/memory"
	"github.com/futsuuu/ku-potato/server/sqlite"
)

func TestLiveOperations(t *testing.T) {
	f := newLiveFixture(t)
	f.run(t, "Status", func(t *testing.T, ctx context.Context) {
		authenticated, err := f.browser.Status(ctx)
		if err != nil || !authenticated {
			t.Fatal("saved authentication did not reach HOME; log in with the server first", err)
		}
	})
	f.run(t, "Login", func(t *testing.T, ctx context.Context) {
		if err := f.browser.Login(ctx, false); err != nil {
			t.Fatal("login with saved authentication", err)
		}
	})
	f.run(t, "Register", func(t *testing.T, ctx context.Context) {
		if !f.hasKey {
			t.Skip("no saved WebAuthn key for duplicate registration verification")
		}
		requireReason(t, f.browser.Register(ctx, false), "conflict")
	})
	f.run(t, "Courses", func(t *testing.T, ctx context.Context) {
		courses := f.courseList(t, ctx)
		again, err := f.browser.Courses(ctx)
		if err != nil || !reflect.DeepEqual(courses, again.Courses) {
			t.Fatal("course list changed across page reuse", err)
		}
		counts := map[string]int{}
		for _, course := range courses {
			if course.Name == "" || (course.Availability == "available" && course.ID == "") {
				t.Fatal("incomplete course metadata")
			}
			if course.AcademicYear != again.AcademicYear || course.AcademicYear < 1 {
				t.Errorf("course %s: incorrect academic year", course.ID)
			}
			switch course.Type {
			case "scheduled":
				if course.Weekday == nil || *course.Weekday < 1 || *course.Weekday > 7 || course.Period == nil || *course.Period < 1 {
					t.Errorf("course %s: incomplete schedule", course.ID)
				}
			case "other":
				if course.Weekday != nil || course.Period != nil {
					t.Errorf("course %s: other course retained a schedule", course.ID)
				}
			default:
				t.Errorf("course %s: unrecognized course type %q; inspect the LMS schedule log", course.ID, course.Type)
			}
			counts[course.Type]++
		}
		t.Logf("read %d courses across requests: %d scheduled, %d other, %d unknown", len(courses), counts["scheduled"], counts["other"], counts["unknown"])
	})
	f.run(t, "Materials", func(t *testing.T, ctx context.Context) {
		course := f.availableCourse(t, ctx)
		snapshot, err := f.browser.Materials(ctx, course.ID)
		if err != nil {
			t.Fatal("read materials", err)
		}
		if snapshot.Materials == nil || snapshot.Materials.CourseID != course.ID {
			t.Fatal("materials do not belong to the requested course")
		}
		for _, folder := range snapshot.Materials.Folders {
			if folder.Name == "" {
				t.Fatal("missing folder name")
			}
			for _, material := range folder.Materials {
				if material.ID == "" || material.Name == "" || material.Type == "" {
					t.Fatal("incomplete material metadata")
				}
			}
		}
		f.materials[course.ID] = snapshot
		t.Logf("read %d folders", len(snapshot.Materials.Folders))
	})
	f.run(t, "Assignments", func(t *testing.T, ctx context.Context) { liveAssignments(t, ctx, f) })
	f.run(t, "Resources", func(t *testing.T, ctx context.Context) {
		selected, _ := f.resource(t, ctx, "")
		snapshot, err := f.browser.Resources(ctx, selected.material, selected.course)
		if err != nil || snapshot.MaterialID != selected.material || len(snapshot.Resources) == 0 {
			t.Fatal("read published resource list", err)
		}
		for _, resource := range snapshot.Resources {
			if resource.ID == "" || resource.Name == "" || resource.Type == "" {
				t.Fatal("incomplete resource metadata")
			}
		}
		t.Logf("read %d resources", len(snapshot.Resources))
	})
	f.run(t, "Download/file", func(t *testing.T, ctx context.Context) {
		selected, _ := f.resource(t, ctx, "file")
		download, err := f.browser.Download(ctx, selected.material, selected.id, selected.course)
		if err != nil {
			t.Fatal("download file", err)
		}
		if download.Filename == "" || !sameDirectory(filepath.Dir(download.Path), f.downloads) {
			t.Fatal("download did not produce a named file in the temporary directory")
		}
		file, err := os.Open(download.Path)
		if err != nil {
			t.Fatal("open downloaded file", err)
		}
		defer file.Close()
		size, err := io.Copy(io.Discard, file)
		if err != nil || size == 0 {
			t.Fatal("downloaded file is empty or unreadable", size, err)
		}
		t.Logf("downloaded and read %d bytes", size)
	})
	f.run(t, "Download/external", func(t *testing.T, ctx context.Context) {
		selected, snapshot := f.resource(t, ctx, "external")
		var expected domain.Resource
		for _, resource := range snapshot.Resources {
			if resource.ID == selected.id {
				expected = resource
			}
		}
		download, err := f.browser.Download(ctx, selected.material, selected.id, selected.course)
		if err != nil || download.URL == "" || download.URL != expected.URL || download.Path != "" {
			t.Fatal("external resource did not return its URL", err)
		}
	})
}

func liveAssignments(t *testing.T, ctx context.Context, f *liveFixture) {
	store, err := sqlite.Open(filepath.Join(t.TempDir(), "archive.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	app := core.New(f.browser, store, memory.NewAuthenticationState(), memory.NewQueue(), nil, 5*time.Minute, 4)
	workers, cancel := context.WithCancel(ctx)
	done := make(chan error, 1)
	go func() { done <- app.Run(workers) }()
	defer func() {
		cancel()
		if err := <-done; err != nil {
			t.Error(err)
		}
	}()
	last := domain.OperationStatus{}
	result, err := app.Assignments(ctx, nil, "true", func(p domain.OperationStatus) error { last = p; return nil })
	if err != nil {
		t.Fatal("synchronize assignments", err)
	}
	for _, failure := range result.Failures {
		t.Errorf("course %s: %s", failure.CourseID, failure.Error.Message)
	}
	if last.Progress != nil && last.Progress.Total == 0 && len(result.Failures) == 0 {
		t.Skip("no available courses for assignment synchronization")
	}
	if last.Progress == nil || last.Progress.Completed != last.Progress.Total {
		t.Fatal("incomplete assignment synchronization progress", last)
	}
	t.Logf("synchronized %d courses; read %d assignments; %d failures", last.Progress.Total, len(result.Assignments), len(result.Failures))
}
