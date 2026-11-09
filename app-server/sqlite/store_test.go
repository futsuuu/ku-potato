package sqlite

import (
	"context"
	"errors"
	"path/filepath"
	"testing"
	"time"

	"github.com/futsuuu/ku-potato/app-server/domain"
)

func TestStoreReopensAndKeepsArchive(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "資料 #%.sqlite")
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.Append(
		ctx,
		domain.Snapshot{
			AcademicYear: 2026,
			Courses:      []domain.Course{{ID: "KOG1", Name: "saved course"}},
		},
	); err != nil {
		t.Fatal(err)
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	s, err = Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = s.Close() }()
	courses, err := s.Courses(ctx)
	if err != nil || len(courses) != 1 || courses[0].ID != "KOG1" {
		t.Fatal(courses, err)
	}
}

func TestStoreEnablesForeignKeys(t *testing.T) {
	s := newStore(t)
	var enabled int
	if err := s.db.QueryRow("PRAGMA foreign_keys").Scan(&enabled); err != nil || enabled != 1 {
		t.Fatalf("foreign keys not enabled: %d %v", enabled, err)
	}
}

func newStore(t *testing.T) *Store {
	t.Helper()
	s, err := Open(filepath.Join(t.TempDir(), "archive.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = s.Close() })
	return s
}

func TestSnapshotsPreserveSavedFiles(t *testing.T) {
	s := newStore(t)
	ctx := context.Background()
	snapshot := domain.Snapshot{
		AcademicYear: 2026,
		Courses:      []domain.Course{{ID: "KOG1", Name: "course"}},
		Materials: &domain.CourseMaterials{
			CourseID: "KOG1",
			Folders:  []domain.Folder{{Name: "week", Materials: []domain.Material{{ID: "SRY1"}}}},
		},
		MaterialID: "SRY1",
		Resources:  []domain.RetrievedResource{{ID: "SRS1", Name: "file", Type: "file"}},
	}
	retrievals, err := s.Append(ctx, snapshot)
	if err != nil {
		t.Fatal(err)
	}
	file := &domain.SavedFile{ID: "test", SHA256: "hash"}
	if _, err := s.ReplaceSavedFile(
		ctx,
		"SRY1",
		"SRS1",
		retrievals.Resources,
		*file,
	); err != nil {
		t.Fatal(err)
	}
	snapshot.Materials.Folders = []domain.Folder{}
	snapshot.Resources = []domain.RetrievedResource{}
	if _, err := s.Append(ctx, snapshot); err != nil {
		t.Fatal(err)
	}
	detail, err := s.Detail(ctx, "SRY1")
	if err != nil {
		t.Fatal(err)
	}
	r := detail.Resources[0]
	if !detail.Material.Archived || r.Availability != "archived" || r.SavedFile == nil ||
		r.SavedFile.ID != "test" {
		t.Fatalf("lost archived state: %#v", detail)
	}
}

func TestRemovedCourseArchivesItsMaterialsAndResources(t *testing.T) {
	s := newStore(t)
	ctx := context.Background()
	if _, err := s.Append(
		ctx,
		domain.Snapshot{
			AcademicYear: 2026,
			Courses:      []domain.Course{{ID: "KOG1", Availability: "available"}},
			Materials: &domain.CourseMaterials{
				CourseID: "KOG1",
				Folders: []domain.Folder{
					{Name: "week", Materials: []domain.Material{{ID: "SRY1"}}},
				},
			},
			MaterialID: "SRY1",
			Resources:  []domain.RetrievedResource{{ID: "SRS1"}},
		},
	); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Append(
		ctx,
		domain.Snapshot{AcademicYear: 2026, Courses: []domain.Course{}},
	); err != nil {
		t.Fatal(err)
	}
	detail, err := s.Detail(ctx, "SRY1")
	if err != nil || !detail.Course.Archived || !detail.Material.Archived ||
		detail.Resources[0].Availability != "archived" {
		t.Fatal(detail, err)
	}
}

func archiveSnapshot() domain.Snapshot {
	return domain.Snapshot{
		AcademicYear: 2026,
		Courses:      []domain.Course{{ID: "KOG1", Name: "course", Availability: "available"}},
		Materials: &domain.CourseMaterials{
			CourseID: "KOG1",
			Folders: []domain.Folder{{Name: "week", Materials: []domain.Material{
				{
					ID:                   "SRY1",
					Name:                 "handout",
					Type:                 "material",
					PublicationDeadline:  "2026-10-31T15:00:00Z",
					ResourceAvailability: "available",
				},
			}}},
		},
		MaterialID: "SRY1",
		Resources: []domain.RetrievedResource{
			{ID: "SRS1", Name: "file", Type: "file"},
			{ID: "SRS2", Name: "not downloaded", Type: "file"},
		},
	}
}

func TestPrivateMaterialPreservesPastDataAcrossRestartAndRepublication(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "archive.sqlite")
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = s.Close() })
	snapshot := archiveSnapshot()
	retrievals, err := s.Append(ctx, snapshot)
	if err != nil {
		t.Fatal(err)
	}
	file := &domain.SavedFile{
		ID:               "saved",
		OriginalFilename: "handout.pdf",
		SHA256:           "hash",
		Size:             42,
	}
	if _, err := s.ReplaceSavedFile(
		ctx,
		"SRY1",
		"SRS1",
		retrievals.Resources,
		*file,
	); err != nil {
		t.Fatal(err)
	}
	before, err := s.Detail(ctx, "SRY1")
	if err != nil {
		t.Fatal(err)
	}
	private := archiveSnapshot()
	m := &private.Materials.Folders[0].Materials[0]
	m.Name, m.PublicationDeadline, m.ResourceAvailability = "private placeholder", "unavailable", "unavailable"
	private.Resources = nil
	if _, err := s.Append(ctx, private); err != nil {
		t.Fatal(err)
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	s, err = Open(path)
	if err != nil {
		t.Fatal(err)
	}
	detail, err := s.Detail(ctx, "SRY1")
	if err != nil {
		t.Fatal(err)
	}
	if !detail.Material.Archived || detail.Material.ResourceAvailability != "unavailable" ||
		detail.Material.Name != "handout" ||
		detail.Material.PublicationDeadline != before.Material.PublicationDeadline ||
		!detail.Material.FetchedAt.Equal(*before.Material.FetchedAt) {
		t.Fatalf("lost last accessible metadata: %#v", detail.Material)
	}
	if len(detail.Resources) != 2 || detail.Resources[0].SavedFile == nil ||
		*detail.Resources[0].SavedFile != *file ||
		detail.Resources[1].Name != "not downloaded" {
		t.Fatalf("lost past resources: %#v", detail.Resources)
	}
	for _, resource := range detail.Resources {
		if resource.Availability != "archived" {
			t.Fatal(resource)
		}
	}
	var count int
	if err := s.db.QueryRow("SELECT count(*) FROM material_resource_retrievals").
		Scan(&count); err != nil ||
		count != 1 {
		t.Fatalf("private retrieval became an empty resource retrieval: %d %v", count, err)
	}
	if _, err := s.Append(ctx, snapshot); err != nil {
		t.Fatal(err)
	}
	detail, err = s.Detail(ctx, "SRY1")
	if err != nil || detail.Material.Archived || detail.Resources[0].Availability != "current" ||
		detail.Resources[0].SavedFile == nil {
		t.Fatal(detail, err)
	}
	// A fetched empty list is a new retrieval, but it retains past resource metadata.
	snapshot.Resources = []domain.RetrievedResource{}
	if _, err := s.Append(ctx, snapshot); err != nil {
		t.Fatal(err)
	}
	detail, err = s.Detail(ctx, "SRY1")
	if err != nil || len(detail.Resources) != 2 || detail.Resources[0].Availability != "archived" {
		t.Fatal(detail, err)
	}
	if err := s.db.QueryRow("SELECT count(*) FROM material_resource_retrievals").
		Scan(&count); err != nil ||
		count != 3 {
		t.Fatal(count, err)
	}
}

func TestLatestRowsDoNotDuplicateRetainedHistory(t *testing.T) {
	s := newStore(t)
	ctx := context.Background()
	snapshot := archiveSnapshot()
	snapshot.Courses = append(snapshot.Courses, domain.Course{ID: "KOG2", Name: "old course"})
	snapshot.Materials.Folders[0].Materials = append(
		snapshot.Materials.Folders[0].Materials,
		domain.Material{ID: "SRY2", Name: "removed", Type: "material"},
	)
	if _, err := s.Append(ctx, snapshot); err != nil {
		t.Fatal(err)
	}
	current := archiveSnapshot()
	current.Resources = current.Resources[:1]
	current.Resources[0].Name = "updated"
	if _, err := s.Append(ctx, current); err != nil {
		t.Fatal(err)
	}
	detail, err := s.Detail(ctx, "SRY1")
	if err != nil || len(detail.Resources) != 2 || detail.Resources[0].Name != "updated" ||
		detail.Resources[1].Availability != "archived" {
		t.Fatal(detail, err)
	}
	materials, err := s.Materials(ctx, "KOG1")
	if err != nil || len(materials.Folders[0].Materials) != 2 ||
		!materials.Folders[0].Materials[1].Archived {
		t.Fatal(materials, err)
	}
	courses, err := s.Courses(ctx)
	if err != nil || len(courses) != 2 || !courses[1].Archived {
		t.Fatal(courses, err)
	}
}

func TestSnapshotConstraintFailureRollsBackAllChanges(t *testing.T) {
	s := newStore(t)
	ctx := context.Background()
	if _, err := s.Append(ctx, archiveSnapshot()); err != nil {
		t.Fatal(err)
	}
	broken := archiveSnapshot()
	broken.Courses[0].Name = "must roll back"
	broken.Materials.Folders[0].Name = "must roll back"
	broken.Resources = append(broken.Resources, broken.Resources[0])
	if _, err := s.Append(ctx, broken); err == nil {
		t.Fatal("accepted duplicate resource")
	}
	detail, err := s.Detail(ctx, "SRY1")
	if err != nil || detail.Course.Name != "course" || len(detail.Resources) != 2 {
		t.Fatal(detail, err)
	}
	materials, err := s.Materials(ctx, "KOG1")
	if err != nil || materials.Folders[0].Name != "week" {
		t.Fatal(materials, err)
	}
	if _, err := s.db.Exec(
		"INSERT INTO course_material_folders VALUES(999,0,'invalid','')",
	); err == nil {
		t.Fatal("accepted invalid foreign key")
	}
}

func TestEmptyAndNeverFetchedListsRemainDistinct(t *testing.T) {
	s := newStore(t)
	ctx := context.Background()
	if _, err := s.Courses(ctx); !errors.Is(err, domain.ErrMissing) {
		t.Fatal(err)
	}
	if _, err := s.Append(
		ctx,
		domain.Snapshot{AcademicYear: 2026, Courses: []domain.Course{}},
	); err != nil {
		t.Fatal(err)
	}
	if courses, err := s.Courses(ctx); err != nil || len(courses) != 0 {
		t.Fatal(courses, err)
	}
	snapshot := archiveSnapshot()
	snapshot.Resources = nil
	if _, err := s.Append(ctx, snapshot); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Detail(ctx, "SRY1"); !errors.Is(err, domain.ErrMissing) {
		t.Fatal(err)
	}
	snapshot.Materials.Folders[0].Materials[0].ResourceAvailability = "unavailable"
	if _, err := s.Append(ctx, snapshot); err != nil {
		t.Fatal(err)
	}
	if detail, err := s.Detail(
		ctx,
		"SRY1",
	); err != nil || len(detail.Resources) != 0 ||
		detail.Material.FetchedAt != nil {
		t.Fatal(detail, err)
	}
}

func TestMaterialFetchedAtRequiresContentsAndSurvivesListingUpdates(t *testing.T) {
	s := newStore(t)
	ctx := context.Background()
	snapshot := archiveSnapshot()
	snapshot.Resources = nil
	snapshot.Materials.Folders[0].Materials = append(snapshot.Materials.Folders[0].Materials,
		domain.Material{ID: "REP1", Type: "report", PublicationDeadline: "no-deadline"})
	if _, err := s.Append(ctx, snapshot); err != nil {
		t.Fatal(err)
	}
	listing, err := s.Materials(ctx, "KOG1")
	if err != nil {
		t.Fatal(err)
	}
	for _, material := range listing.Folders[0].Materials {
		if material.FetchedAt != nil {
			t.Fatalf("listing-only material has a content timestamp: %#v", material)
		}
	}
	// Even an empty resource list is a successfully fetched material detail.
	if _, err := s.Append(
		ctx,
		domain.Snapshot{MaterialID: "SRY1", Resources: []domain.RetrievedResource{}},
	); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Append(
		ctx,
		domain.Snapshot{MaterialID: "REP1", Report: &domain.ReportDetail{}},
	); err != nil {
		t.Fatal(err)
	}
	if _, err := s.db.Exec("UPDATE material_resource_retrievals SET fetched_at=1000"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.db.Exec("UPDATE report_detail_retrievals SET fetched_at=2000"); err != nil {
		t.Fatal(err)
	}
	for _, private := range []bool{false, true} {
		for i := range snapshot.Materials.Folders[0].Materials {
			if private {
				snapshot.Materials.Folders[0].Materials[i].ResourceAvailability = "unavailable"
			}
		}
		if _, err := s.Append(ctx, snapshot); err != nil {
			t.Fatal(err)
		}
		listing, err = s.Materials(ctx, "KOG1")
		if err != nil {
			t.Fatal(err)
		}
		for _, material := range listing.Folders[0].Materials {
			if material.Type == "report" {
				if material.FetchedAt != nil {
					t.Fatalf("report claims fetched material contents: %#v", material)
				}
				continue
			}
			want := time.UnixMilli(1000)
			if material.FetchedAt == nil || !material.FetchedAt.Equal(want) ||
				material.Archived != private {
				t.Fatalf("listing replaced content acquisition state: %#v, want %v", material, want)
			}
		}
	}
}

func TestUnsupportedMaterialTypesDoNotClaimFetchedContents(t *testing.T) {
	for _, kind := range []string{"report", "test", "questionnaire", "e-learning", "board", "feedback", "unknown"} {
		t.Run(kind, func(t *testing.T) {
			s := newStore(t)
			ctx := context.Background()
			snapshot := archiveSnapshot()
			snapshot.Materials.Folders[0].Materials[0].Type = kind
			// Legacy resource retrievals must not stand in for unsupported content.
			if _, err := s.Append(ctx, snapshot); err != nil {
				t.Fatal(err)
			}
			snapshot.Resources = nil
			snapshot.Materials.Folders[0].Materials[0].ResourceAvailability = "unavailable"
			if _, err := s.Append(ctx, snapshot); err != nil {
				t.Fatal(err)
			}
			listing, err := s.Materials(ctx, "KOG1")
			if err != nil {
				t.Fatal(err)
			}
			material := listing.Folders[0].Materials[0]
			if !material.Archived || material.FetchedAt != nil {
				t.Fatalf("unsupported material claims fetched contents: %#v", material)
			}
		})
	}
}

func TestCoursesWithoutIDsPreserveTheirPositions(t *testing.T) {
	s := newStore(t)
	ctx := context.Background()
	if _, err := s.Append(ctx, domain.Snapshot{AcademicYear: 2026, Courses: []domain.Course{
		{Name: "same name", Availability: "unavailable"},
		{Name: "same name", Availability: "unavailable"},
		{ID: "KOG1", Name: "first placement"},
		{ID: "KOG1", Name: "second placement"},
	}}); err != nil {
		t.Fatal(err)
	}
	courses, err := s.Courses(ctx)
	if err != nil || len(courses) != 4 {
		t.Fatal(courses, err)
	}
	for i, want := range []struct{ id, name string }{
		{"", "same name"}, {"", "same name"}, {"KOG1", "first placement"}, {"KOG1", "second placement"},
	} {
		if courses[i].ID != want.id || courses[i].Name != want.name {
			t.Fatalf("course %d = %#v, want id=%q name=%q", i, courses[i], want.id, want.name)
		}
	}
}
