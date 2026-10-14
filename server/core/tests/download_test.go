package tests

import (
	"context"
	"io"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/futsuuu/ku-potato/server/core"
	"github.com/futsuuu/ku-potato/server/core/outport"
	"github.com/futsuuu/ku-potato/server/domain"
	"github.com/futsuuu/ku-potato/server/filesystem"
	"github.com/futsuuu/ku-potato/server/memory"
	"github.com/futsuuu/ku-potato/server/sqlite"
)

type externalFileSource struct {
	outport.Source
	snapshot  domain.Snapshot
	path      string
	cachedURL chan string
}

func (s externalFileSource) Download(_ context.Context, _, _, _, cachedURL string) (domain.Download, error) {
	s.cachedURL <- cachedURL
	return domain.Download{Snapshot: s.snapshot, Path: s.path, Filename: "handout.pdf"}, nil
}

func TestExternalDownloadIsArchivedAndDeliveredAsFile(t *testing.T) {
	root := t.TempDir()
	store, err := sqlite.Open(filepath.Join(root, "archive.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	snapshot := domain.Snapshot{
		AcademicYear: 2026, Courses: []domain.Course{{ID: "KOG1", Name: "course", Availability: "available"}},
		Materials:  &domain.CourseMaterials{CourseID: "KOG1", Folders: []domain.Folder{{Name: "week", Materials: []domain.Material{{ID: "SRY1", Type: "material"}}}}},
		MaterialID: "SRY1", Resources: []domain.Resource{{ID: "SRS1", Name: "external", Type: "external", URL: "https://drive.google.com/file/d/file/view"}},
	}
	if _, err := store.Append(context.Background(), snapshot); err != nil {
		t.Fatal(err)
	}
	staging := filepath.Join(root, "staging")
	if err := os.WriteFile(staging, []byte("%PDF fixture"), 0600); err != nil {
		t.Fatal(err)
	}
	files, err := filesystem.New(filepath.Join(root, "files"))
	if err != nil {
		t.Fatal(err)
	}
	cachedURL := make(chan string, 1)
	app := core.New(externalFileSource{snapshot: snapshot, path: staging, cachedURL: cachedURL}, store, memory.NewAuthenticationState(), memory.NewQueue(), files, time.Second, 1)
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- app.Run(ctx) }()
	defer func() {
		cancel()
		if err := <-done; err != nil {
			t.Error(err)
		}
	}()
	request, stop := context.WithTimeout(ctx, 5*time.Second)
	defer stop()
	result, err := app.Download(request, "SRY1", "SRS1", nil)
	if err != nil || result.Type != "file" || result.File == nil || result.File.Size != 12 {
		t.Fatal("external resource was not saved as file", result, err)
	}
	if got := <-cachedURL; got != snapshot.Resources[0].URL {
		t.Fatal("archived URL was not passed to the source", got)
	}
	detail, err := store.Detail(request, "SRY1")
	if err != nil || len(detail.Resources) != 1 || detail.Resources[0].Type != "external" || detail.Resources[0].SavedFile == nil || detail.Resources[0].URL != snapshot.Resources[0].URL {
		t.Fatal("external URL or saved file was lost", detail, err)
	}
	file, err := app.File(request, "SRY1", "SRS1")
	if err != nil {
		t.Fatal(err)
	}
	defer file.Content.Close()
	body, err := io.ReadAll(file.Content)
	if err != nil || string(body) != "%PDF fixture" {
		t.Fatal("file delivery failed", string(body), err)
	}
	if _, err := os.Stat(staging); !os.IsNotExist(err) {
		t.Fatal("staging file was retained", err)
	}
}
