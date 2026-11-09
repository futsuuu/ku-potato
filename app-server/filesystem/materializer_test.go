package filesystem

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/futsuuu/ku-potato/app-server/domain"
)

func TestMaterializerReusesAndRefreshesCopies(t *testing.T) {
	temp := t.TempDir()
	materializer, err := NewMaterializer(temp)
	if err != nil {
		t.Fatal(err)
	}
	if filepath.Dir(materializer.root) != filepath.Join(temp, "ku-potato-opened-resources") {
		t.Fatal("prepared files are not in temp", materializer.root)
	}
	saved := domain.SavedFile{
		ContentHash:      strings.Repeat("a", 64),
		OriginalFilename: `../資料.pdf`,
		OriginalSize:     int64(len("saved bytes")),
	}
	prepare := func(content string) string {
		t.Helper()
		path, err := materializer.Prepare(context.Background(), strings.NewReader(content), saved)
		if err != nil {
			t.Fatal(err)
		}
		body, err := os.ReadFile(path)
		if err != nil || string(body) != "saved bytes" || filepath.Base(path) != "資料.pdf" ||
			!filepath.IsAbs(path) {
			t.Fatal("incorrect prepared file", path, string(body), err)
		}
		return path
	}
	first := prepare("saved bytes")
	cached, err := materializer.Prepare(
		context.Background(),
		failingReader{errors.New("unexpected read")},
		saved,
	)
	if err != nil || cached != first {
		t.Fatal("cached file was read again", cached, err)
	}
	if err := os.Truncate(first, 1); err != nil {
		t.Fatal(err)
	}
	replaced := prepare("saved bytes")
	if replaced == first {
		t.Fatal("truncated file was reused")
	}
	saved.ContentHash = strings.Repeat("b", 64)
	latest := prepare("saved bytes")
	if latest == replaced {
		t.Fatal("redownload reused the old file")
	}
	if _, err := NewMaterializer(temp); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(latest); !os.IsNotExist(err) {
		t.Fatal("previous session was not cleaned up", err)
	}
}

func TestMaterializerRejectsIncompleteAndCanceledCopies(t *testing.T) {
	materializer, err := NewMaterializer(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	saved := domain.SavedFile{
		ContentHash:      strings.Repeat("a", 64),
		OriginalFilename: "file.txt",
		OriginalSize:     4,
	}
	failed := errors.New("copy failed")
	if path, err := materializer.Prepare(
		context.Background(),
		failingReader{failed},
		saved,
	); !errors.Is(err, failed) ||
		path != "" {
		t.Fatal(path, err)
	}
	if path, err := materializer.Prepare(
		context.Background(),
		strings.NewReader("bad"),
		saved,
	); err == nil ||
		path != "" {
		t.Fatal("incomplete file was accepted", path, err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if path, err := materializer.Prepare(
		ctx,
		strings.NewReader("body"),
		saved,
	); !errors.Is(err, context.Canceled) ||
		path != "" {
		t.Fatal(path, err)
	}
	entries, err := os.ReadDir(materializer.root)
	if err != nil || len(entries) != 0 {
		t.Fatal("failed copy left files behind", err, entries)
	}
}

func TestMaterializerConcurrentRequestsUseOneCopy(t *testing.T) {
	materializer, err := NewMaterializer(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	var group sync.WaitGroup
	paths := make(chan string, 8)
	for range 8 {
		group.Go(func() {
			path, err := materializer.Prepare(
				context.Background(),
				strings.NewReader("body"),
				domain.SavedFile{
					ContentHash:      strings.Repeat("a", 64),
					OriginalFilename: "file.txt",
					OriginalSize:     4,
				},
			)
			if err != nil {
				t.Error(err)
			}
			paths <- path
		})
	}
	group.Wait()
	close(paths)
	first := <-paths
	for path := range paths {
		if path != first {
			t.Fatal("concurrent requests created separate copies", first, path)
		}
	}
}

type failingReader struct{ err error }

func (r failingReader) Read([]byte) (int, error) { return 0, r.err }
