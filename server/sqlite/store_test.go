package sqlite

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"

	"github.com/futsuuu/ku-potato/server/domain"
)

func TestLegacyJobsAreRemovedWhileArchiveSurvives(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "archive.sqlite")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.Exec(`CREATE TABLE snapshots(kind TEXT NOT NULL, id TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(kind,id));
	INSERT INTO snapshots VALUES('courses', '', '[{"lmsCourseId":"KOG1","name":"saved course"}]');
	CREATE TABLE jobs(id TEXT PRIMARY KEY, status TEXT, body TEXT);
	INSERT INTO jobs VALUES('old', 'running', '{}');
	PRAGMA user_version=1;`)
	if err != nil {
		db.Close()
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	courses, err := s.Courses(ctx)
	if err != nil || len(courses) != 1 || courses[0].ID != "KOG1" {
		t.Fatal(courses, err)
	}
	var count int
	if err := s.db.QueryRow("SELECT count(*) FROM sqlite_master WHERE name='jobs'").Scan(&count); err != nil || count != 0 {
		t.Fatalf("jobs table retained: %d %v", count, err)
	}
}

func newStore(t *testing.T) *Store {
	t.Helper()
	s, err := Open(filepath.Join(t.TempDir(), "archive.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	return s
}
func TestSnapshotsPreserveFilesAndFailedAcquisition(t *testing.T) {
	s := newStore(t)
	ctx := context.Background()
	snapshot := domain.Snapshot{Courses: []domain.Course{{ID: "KOG1", Name: "course"}}, Materials: &domain.CourseMaterials{CourseID: "KOG1", Folders: []domain.Folder{{Name: "week", Materials: []domain.Material{{ID: "SRY1"}}}}}, MaterialID: "SRY1", Resources: []domain.Resource{{ID: "SRS1", Name: "file", Type: "file"}}}
	if err := s.Append(ctx, snapshot); err != nil {
		t.Fatal(err)
	}
	file := &domain.SavedFile{ID: "test", SHA256: "hash"}
	if err := s.Acquired(ctx, "SRY1", "SRS1", file, nil); err != nil {
		t.Fatal(err)
	}
	snapshot.Materials.Folders = []domain.Folder{}
	snapshot.Resources = []domain.Resource{}
	if err := s.Append(ctx, snapshot); err != nil {
		t.Fatal(err)
	}
	if err := s.Acquired(ctx, "SRY1", "SRS1", nil, domain.Fail("source", "failed")); err != nil {
		t.Fatal(err)
	}
	detail, err := s.Detail(ctx, "SRY1")
	if err != nil {
		t.Fatal(err)
	}
	r := detail.Resources[0]
	if !detail.Material.Archived || r.Availability != "archived" || r.SavedFile.ID != "test" || r.Acquisition.LastSucceededAt == nil || r.Acquisition.LastAttempt.Status != "failure" {
		t.Fatalf("lost archived state: %#v", detail)
	}
}
func TestRemovedCourseArchivesItsMaterialsAndResources(t *testing.T) {
	s := newStore(t)
	ctx := context.Background()
	if err := s.Append(ctx, domain.Snapshot{Courses: []domain.Course{{ID: "KOG1", Availability: "available"}}, Materials: &domain.CourseMaterials{CourseID: "KOG1", Folders: []domain.Folder{{Name: "week", Materials: []domain.Material{{ID: "SRY1"}}}}}, MaterialID: "SRY1", Resources: []domain.Resource{{ID: "SRS1"}}}); err != nil {
		t.Fatal(err)
	}
	if err := s.Append(ctx, domain.Snapshot{Courses: []domain.Course{}}); err != nil {
		t.Fatal(err)
	}
	detail, err := s.Detail(ctx, "SRY1")
	if err != nil || !detail.Course.Archived || !detail.Material.Archived || detail.Resources[0].Availability != "archived" {
		t.Fatal(detail, err)
	}
}
