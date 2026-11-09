package tests

import (
	"context"
	"errors"
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

type replacementSource struct {
	outport.ContentSource
	result outport.Download
	err    error
}

func (s replacementSource) Download(
	context.Context,
	string,
	string,
	string,
) (outport.Download, error) {
	return s.result, s.err
}

type replacementArchive struct {
	outport.Archive
	err                   error
	details, replacements int
}

func (a *replacementArchive) Detail(ctx context.Context, material string) (domain.Detail, error) {
	a.details++
	return a.Archive.Detail(ctx, material)
}

func (a *replacementArchive) ReplaceSavedFile(
	ctx context.Context,
	material, resource string,
	retrievalID string,
	file domain.SavedFile,
) (*domain.SavedFile, error) {
	a.replacements++
	if a.err != nil {
		return nil, a.err
	}
	return a.Archive.ReplaceSavedFile(ctx, material, resource, retrievalID, file)
}

func TestDownloadReplacesOnlySuccessfullySavedFiles(t *testing.T) {
	for _, scenario := range []string{"success", "source failure", "save failure", "database failure", "external link"} {
		t.Run(scenario, func(t *testing.T) {
			root := t.TempDir()
			ctx := context.Background()
			store, err := sqlite.Open(filepath.Join(root, "archive.sqlite"))
			if err != nil {
				t.Fatal(err)
			}
			defer func() { _ = store.Close() }()
			filesRoot := filepath.Join(root, "files")
			files, err := filesystem.New(filesRoot)
			if err != nil {
				t.Fatal(err)
			}
			snapshot := domain.Snapshot{
				AcademicYear: 2026,
				Courses:      []domain.Course{{ID: "KOG1", Availability: "available"}},
				Materials: &domain.CourseMaterials{
					CourseID: "KOG1",
					Folders: []domain.Folder{
						{Materials: []domain.Material{{ID: "SRY1", Type: "material"}}},
					},
				},
				MaterialID: "SRY1",
				Resources:  []domain.RetrievedResource{{ID: "SRS1", Name: "file", Type: "file"}},
			}
			ids, err := store.Append(ctx, snapshot)
			if err != nil {
				t.Fatal(err)
			}
			staging := filepath.Join(root, "staging")
			if err := os.WriteFile(staging, []byte("previous"), 0o600); err != nil {
				t.Fatal(err)
			}
			old, err := files.Save(staging, "previous.txt")
			if err != nil {
				t.Fatal(err)
			}
			if _, err := store.ReplaceSavedFile(
				ctx,
				"SRY1",
				"SRS1",
				ids.Resources,
				old,
			); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(staging, []byte("replacement"), 0o600); err != nil {
				t.Fatal(err)
			}
			failure := domain.Fail("source", "failed fixture")
			source := replacementSource{
				result: outport.Download{Snapshot: snapshot, Path: staging, Filename: "new.txt"},
			}
			archive := &replacementArchive{Archive: store}
			wantFailure := false
			switch scenario {
			case "source failure":
				source.err = failure
				wantFailure = true
			case "save failure":
				source.result.Path = filepath.Join(root, "missing")
				wantFailure = true
			case "database failure":
				archive.err = failure
				wantFailure = true
			case "external link":
				source.result.Path = ""
				source.result.URL = "https://example.com/link"
			}
			app := application.New(
				source,
				archive,
				authstate.NewAuthenticationState(),
				files,
				5*time.Second,
				1,
			)
			result, err := app.Download(ctx, "SRY1", "SRS1", nil)
			if (err != nil) != wantFailure {
				t.Fatalf("download = %+v, error = %v", result, err)
			}
			if archive.details != 1 {
				t.Fatal("replacement reread material detail", archive.details)
			}
			current, err := store.SavedFile(ctx, "SRY1", "SRS1")
			if err != nil {
				t.Fatal(err)
			}
			wantBody := "previous"
			if scenario == "success" {
				wantBody = "replacement"
				if current.ID == old.ID {
					t.Fatal("successful download did not replace file")
				}
				if _, err := files.Open(old); !errors.Is(err, domain.ErrMissing) {
					t.Fatal("superseded file was retained", err)
				}
			} else if current != old {
				t.Fatal("failed or non-file download changed saved file", current, old)
			}
			file, err := app.File(ctx, "SRY1", "SRS1")
			if err != nil {
				t.Fatal(err)
			}
			body, err := io.ReadAll(file.Content)
			_ = file.Content.Close()
			if err != nil || string(body) != wantBody || archive.details != 1 {
				t.Fatal(
					"saved file read depended on material detail or lost content",
					string(body),
					err,
					archive.details,
				)
			}
			entries, err := os.ReadDir(filesRoot)
			if err != nil || len(entries) != 1 || entries[0].Name() != current.ID {
				t.Fatal("orphan or file history retained", entries, err)
			}
			wantReplacements := 0
			if scenario == "success" || scenario == "database failure" {
				wantReplacements = 1
			}
			if archive.replacements != wantReplacements {
				t.Fatal("non-file download tried to register a file", archive.replacements)
			}
		})
	}
}
