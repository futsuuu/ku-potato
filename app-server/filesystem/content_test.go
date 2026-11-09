package filesystem

import (
	"bytes"
	"crypto/sha256"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sync"
	"testing"
)

func TestSameContentReusesLocalEncodingRegardlessOfFilename(t *testing.T) {
	for _, first := range []string{"handout.txt", "bundle.zip"} {
		t.Run(first, func(t *testing.T) {
			root := t.TempDir()
			files, err := New(filepath.Join(root, "files"))
			if err != nil {
				t.Fatal(err)
			}
			body := []byte("same content shared between resources")
			source := filepath.Join(root, "source")
			if err := os.WriteFile(source, body, 0o600); err != nil {
				t.Fatal(err)
			}
			original, err := files.Save(source, first)
			if err != nil {
				t.Fatal(err)
			}
			path, err := files.path(original)
			if err != nil {
				t.Fatal(err)
			}
			before, err := os.Stat(path)
			if err != nil {
				t.Fatal(err)
			}
			var wg sync.WaitGroup
			for _, filename := range []string{"renamed.txt", "renamed.zip", "renamed.pdf", "renamed.zst"} {
				wg.Go(func() {
					saved, err := files.Save(source, filename)
					if err != nil || saved.ID != original.ID || saved.SHA256 != saved.ID ||
						saved.OriginalFilename != filename {
						t.Error(saved, err)
					}
				})
			}
			wg.Wait()
			after, err := os.Stat(path)
			if err != nil || !os.SameFile(before, after) {
				t.Fatal("healthy content was replaced", err)
			}
			wantName := fmt.Sprintf("%x", sha256.Sum256(body))
			if !alreadyCompressed(first) {
				wantName += zstdSuffix
			}
			entries, err := os.ReadDir(files.root)
			if err != nil || len(entries) != 1 || entries[0].Name() != wantName {
				t.Fatal(entries, err)
			}
			// Encoding is rediscovered locally after restart, not carried in ID.
			reopened, err := New(files.root)
			if err != nil {
				t.Fatal(err)
			}
			original.OriginalFilename = "different.zip"
			file, err := reopened.Open(original)
			if err != nil {
				t.Fatal(err)
			}
			actual, err := io.ReadAll(file)
			_ = file.Close()
			if err != nil || !bytes.Equal(actual, body) {
				t.Fatal(string(actual), err)
			}
			if err := reopened.Remove(original); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestEmptyContentAndFailedSaveLeaveNoTemporaryFiles(t *testing.T) {
	root := t.TempDir()
	files, err := New(filepath.Join(root, "files"))
	if err != nil {
		t.Fatal(err)
	}
	source := filepath.Join(root, "source")
	if err := os.WriteFile(source, nil, 0o600); err != nil {
		t.Fatal(err)
	}
	saved, err := files.Save(source, "empty.txt")
	if err != nil || saved.ID != fmt.Sprintf("%x", sha256.Sum256(nil)) || saved.Size != 0 {
		t.Fatal(saved, err)
	}
	path, err := files.path(saved)
	if err != nil {
		t.Fatal(err)
	}
	before, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if again, err := files.Save(source, "empty.zip"); err != nil || again.ID != saved.ID {
		t.Fatal(again, err)
	}
	after, err := os.Stat(path)
	if err != nil || !os.SameFile(before, after) {
		t.Fatal("healthy empty content was replaced", err)
	}
	if _, err := files.Save(root, "directory"); err == nil {
		t.Fatal("saved directory")
	}
	entries, err := os.ReadDir(files.root)
	if err != nil || len(entries) != 1 {
		t.Fatal("temporary file left behind", entries, err)
	}
}
