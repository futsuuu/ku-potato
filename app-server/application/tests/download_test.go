package tests

import (
	"context"
	"io"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/futsuuu/ku-potato/app-server/application"
	"github.com/futsuuu/ku-potato/app-server/application/outport"
	"github.com/futsuuu/ku-potato/app-server/authstate"
	"github.com/futsuuu/ku-potato/app-server/domain"
	"github.com/futsuuu/ku-potato/app-server/filesystem"
	"github.com/futsuuu/ku-potato/app-server/sqlite"
)

type resourceOpener func(context.Context, io.Reader, domain.SavedFile) error

func (open resourceOpener) Open(ctx context.Context, content io.Reader, file domain.SavedFile) error {
	return open(ctx, content, file)
}

type externalFileSource struct {
	outport.ContentSource
	snapshot domain.Snapshot
}

func (s externalFileSource) Download(_ context.Context, _, _, _ string) (outport.Download, error) {
	return outport.Download{Snapshot: s.snapshot, URL: s.snapshot.Resources[0].URL}, nil
}

type externalFileDownloader struct{ path string }

func (d externalFileDownloader) Key(url string) (string, bool) { return url, true }
func (d externalFileDownloader) Download(context.Context, string) (string, string, error) {
	return d.path, "handout.pdf", nil
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
	opens := 0
	app := application.New(externalFileSource{snapshot: snapshot}, store, authstate.NewAuthenticationState(), files, time.Second, 1,
		application.WithExternalDownloader(externalFileDownloader{path: staging}),
		application.WithResourceOpener(resourceOpener(func(_ context.Context, content io.Reader, saved domain.SavedFile) error {
			body, err := io.ReadAll(content)
			if err != nil || string(body) != "%PDF fixture" || saved.OriginalFilename != "handout.pdf" {
				t.Fatalf("wrong external file: %q %v %v", body, saved, err)
			}
			opens++
			return nil
		})))
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
	if err := app.OpenResource(request, "SRY1", "SRS1"); err != nil || opens != 1 {
		t.Fatal("downloaded external file did not open", err, opens)
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
