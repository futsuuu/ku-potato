package sqlite

import (
	"context"
	"errors"
	"reflect"
	"testing"

	"github.com/futsuuu/ku-potato/app-server/domain"
)

func TestSavedFileKeepsItsExactResourceRetrieval(t *testing.T) {
	s := newStore(t)
	ctx := context.Background()
	snapshot := archiveSnapshot()
	snapshot.Report = &domain.ReportDetail{}
	first, err := s.Append(ctx, snapshot)
	if err != nil {
		t.Fatal(err)
	}
	snapshot.Resources[0].Name = "new version"
	second, err := s.Append(ctx, snapshot)
	if err != nil {
		t.Fatal(err)
	}
	file := domain.SavedFile{ID: "saved", OriginalFilename: "file", SHA256: "hash", Size: 1}
	if previous, err := s.ReplaceSavedFile(
		ctx,
		"SRY1",
		"SRS1",
		first.Resources,
		file,
	); err != nil ||
		previous != nil {
		t.Fatal(previous, err)
	}
	detail, err := s.Detail(ctx, "SRY1")
	if err != nil || detail.Resources[0].Name != "new version" ||
		detail.Resources[0].SavedFile == nil || *detail.Resources[0].SavedFile != file {
		t.Fatal(detail, err)
	}
	var retrievalID string
	if err := s.db.QueryRow("SELECT resource_retrieval_id FROM saved_resources").
		Scan(&retrievalID); err != nil || retrievalID != first.Resources || retrievalID == second.Resources {
		t.Fatal(retrievalID, err)
	}
	other, err := s.Append(ctx, domain.Snapshot{
		MaterialID: "SRY2",
		Resources:  []domain.RetrievedResource{{ID: "SRS1", Type: "file"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	for _, invalid := range []string{"", first.Courses, first.Materials, first.Report, other.Resources} {
		if _, err := s.ReplaceSavedFile(ctx, "SRY1", "SRS1", invalid, file); err == nil {
			t.Fatal("accepted invalid retrieval", invalid)
		}
	}
	// A fresh file ID prevents a UNIQUE violation from masking a missing resource foreign key.
	missingResourceFile := file
	missingResourceFile.ID = "unassigned"
	if _, err := s.ReplaceSavedFile(
		ctx,
		"SRY1",
		"SRS3",
		first.Resources,
		missingResourceFile,
	); err == nil {
		t.Fatal("accepted resource absent from retrieval")
	}
	got, err := s.SavedFile(ctx, "SRY1", "SRS1")
	if err != nil || got != file {
		t.Fatal("invalid replacement changed saved file", got, err)
	}
}

func TestSavedFilesOnlyKeepCurrentFile(t *testing.T) {
	s := newStore(t)
	ctx := context.Background()
	ids, err := s.Append(ctx, archiveSnapshot())
	if err != nil {
		t.Fatal(err)
	}
	var count int
	if err := s.db.QueryRow("SELECT count(*) FROM saved_resources").
		Scan(&count); err != nil ||
		count != 0 {
		t.Fatal("retrieval created empty saved file rows", count, err)
	}
	if _, err := s.SavedFile(ctx, "SRY1", "SRS1"); !errors.Is(err, domain.ErrMissing) {
		t.Fatal(err)
	}
	first := domain.SavedFile{ID: "first", OriginalFilename: "first.pdf", SHA256: "hash", Size: 1}
	second := domain.SavedFile{
		ID:               "second",
		OriginalFilename: "second.pdf",
		SHA256:           "hash2",
		Size:             2,
	}
	if _, err := s.ReplaceSavedFile(ctx, "SRY1", "SRS1", ids.Resources, first); err != nil {
		t.Fatal(err)
	}
	previous, err := s.ReplaceSavedFile(ctx, "SRY1", "SRS1", ids.Resources, second)
	if err != nil || previous == nil || *previous != first {
		t.Fatal(previous, err)
	}
	got, err := s.SavedFile(ctx, "SRY1", "SRS1")
	if err != nil || got != second {
		t.Fatal(got, err)
	}
	if err := s.db.QueryRow("SELECT count(*) FROM saved_resources").
		Scan(&count); err != nil ||
		count != 1 {
		t.Fatal("replacement kept file history", count, err)
	}
	for _, key := range [][2]string{{"SRY1", "SRS2"}, {"SRY2", "SRS1"}} {
		if _, err := s.SavedFile(ctx, key[0], key[1]); !errors.Is(err, domain.ErrMissing) {
			t.Fatal("saved file leaked to another resource", key, err)
		}
	}
}

func TestRetrievedResourceMetadataIsPreserved(t *testing.T) {
	s := newStore(t)
	ctx := context.Background()
	snapshot := archiveSnapshot()
	registered, viewed, description := "2026-10-28", "2026-10-29", "handout description"
	retrieved := domain.RetrievedResource{
		ID: "SRS1", Name: "handout.pdf", Type: "file", Status: "viewed",
		RegisteredOn: &registered, FirstViewedOn: &viewed, Description: &description,
		URL: "https://example.com/file",
	}
	snapshot.Resources = []domain.RetrievedResource{retrieved}
	if _, err := s.Append(ctx, snapshot); err != nil {
		t.Fatal(err)
	}
	detail, err := s.Detail(ctx, "SRY1")
	if err != nil || len(detail.Resources) != 1 {
		t.Fatal(detail, err)
	}
	want := domain.Resource{
		ID: retrieved.ID, Name: retrieved.Name, Type: retrieved.Type, Status: retrieved.Status,
		RegisteredOn: &registered, FirstViewedOn: &viewed, Description: &description,
		URL: retrieved.URL, Availability: "current",
	}
	if !reflect.DeepEqual(detail.Resources[0], want) {
		t.Fatalf("resource = %+v, want %+v", detail.Resources[0], want)
	}
}
