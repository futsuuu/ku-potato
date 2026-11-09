package sqlite

import (
	"context"
	"reflect"
	"testing"

	"github.com/futsuuu/ku-potato/app-server/domain"
)

func TestSavedFileKeepsItsExactResourceObservation(t *testing.T) {
	s := newStore(t)
	ctx := context.Background()
	snapshot := archiveSnapshot()
	first, err := s.Append(ctx, snapshot)
	if err != nil {
		t.Fatal(err)
	}
	snapshot.Resources[0].Name = "new version"
	second, err := s.Append(ctx, snapshot)
	if err != nil {
		t.Fatal(err)
	}
	file := &domain.SavedFile{ID: "saved", OriginalFilename: "file", SHA256: "hash", Size: 1}
	if err := s.Acquired(ctx, "SRY1", "SRS1", first.Resources, file, nil); err != nil {
		t.Fatal(err)
	}
	other, err := s.Append(
		ctx,
		domain.Snapshot{
			MaterialID: "SRY2",
			Resources:  []domain.RetrievedResource{{ID: "SRS1", Type: "file"}},
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.Acquired(ctx, "SRY1", "SRS1", other.Resources, file, nil); err == nil {
		t.Fatal("accepted another material's retrieval")
	}
	if err := s.Acquired(ctx, "SRY1", "SRS1", 0, file, nil); err == nil {
		t.Fatal("accepted missing retrieval")
	}
	if err := s.Acquired(
		ctx,
		"SRY1",
		"SRS1",
		second.Resources,
		nil,
		domain.Fail("source", "failed"),
	); err != nil {
		t.Fatal(err)
	}
	detail, err := s.Detail(ctx, "SRY1")
	if err != nil {
		t.Fatal(err)
	}
	r := detail.Resources[0]
	if r.RetrievalID != second.Resources || r.SavedResourceRetrievalID == nil ||
		*r.SavedResourceRetrievalID != first.Resources ||
		r.SavedFile.ID != file.ID ||
		r.Acquisition.LastAttempt.Status != "failure" {
		t.Fatal(r)
	}
	if _, err := s.db.Exec(
		"UPDATE resource_states SET saved_resource_retrieval_id = ? WHERE lms_material_id='SRY1' AND lms_resource_id='SRS2'",
		first.Resources,
	); err == nil {
		t.Fatal("accepted observation without a saved file")
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
	ids, err := s.Append(ctx, snapshot)
	if err != nil {
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
	want.RetrievalID = ids.Resources
	if !reflect.DeepEqual(detail.Resources[0], want) {
		t.Fatalf("resource = %+v, want %+v", detail.Resources[0], want)
	}
}
