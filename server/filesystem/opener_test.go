package filesystem

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/futsuuu/ku-potato/server/domain"
)

func TestOpenerCopiesFileForDefaultApp(t *testing.T) {
	temp := t.TempDir()
	opener, err := NewOpener(temp)
	if err != nil {
		t.Fatal(err)
	}
	if filepath.Dir(opener.root) != filepath.Join(temp, "ku-potato-opened-resources") {
		t.Fatal("opened files are not in temp", opener.root)
	}
	calls := 0
	var paths []string
	opener.launch = func(path string) error {
		calls++
		if filepath.Base(path) != "資料.pdf" {
			t.Fatal("filename changed", path)
		}
		data, err := os.ReadFile(path)
		if err != nil || string(data) != "saved bytes" {
			t.Fatal("incorrect file content", err, string(data))
		}
		paths = append(paths, path)
		return nil
	}
	saved := domain.SavedFile{ID: "first", OriginalFilename: `../資料.pdf`, Size: int64(len("saved bytes"))}
	if err := opener.Open(context.Background(), strings.NewReader("saved bytes"), saved); err != nil || calls != 1 {
		t.Fatal(err, calls)
	}
	if err := opener.Open(context.Background(), failingReader{errors.New("unexpected read")}, saved); err != nil || calls != 2 {
		t.Fatal("cached file was read again", err, calls)
	}
	if paths[0] != paths[1] {
		t.Fatal("cache hit used a new file", paths)
	}
	if err := os.Truncate(paths[0], 1); err != nil {
		t.Fatal(err)
	}
	if err := opener.Open(context.Background(), strings.NewReader("saved bytes"), saved); err != nil || calls != 3 {
		t.Fatal("truncated copy was not replaced", err, calls)
	}
	if paths[2] == paths[0] {
		t.Fatal("truncated file was reused", paths)
	}
	saved.ID = "redownloaded"
	if err := opener.Open(context.Background(), strings.NewReader("saved bytes"), saved); err != nil || calls != 4 {
		t.Fatal("new version was not opened", err, calls)
	}
	if paths[3] == paths[2] {
		t.Fatal("redownload reused the old file", paths)
	}
	if _, err := NewOpener(temp); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(paths[3]); !os.IsNotExist(err) {
		t.Fatal("previous session was not cleaned up", err)
	}
}

func TestOpenerCleansFailedCopies(t *testing.T) {
	opener, err := NewOpener(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	failed := errors.New("copy failed")
	opener.launch = func(string) error { t.Fatal("must not launch incomplete file"); return nil }
	saved := domain.SavedFile{ID: "first", OriginalFilename: "file.txt", Size: 4}
	if err := opener.Open(context.Background(), failingReader{failed}, saved); !errors.Is(err, failed) {
		t.Fatal(err)
	}
	entries, err := os.ReadDir(opener.root)
	if err != nil || len(entries) != 0 {
		t.Fatal("failed copy left files behind", err, entries)
	}
	opener.launch = func(string) error { return failed }
	if err := opener.Open(context.Background(), strings.NewReader("body"), saved); !errors.Is(err, failed) {
		t.Fatal(err)
	}
	entries, err = os.ReadDir(opener.root)
	if err != nil || len(entries) != 0 {
		t.Fatal("failed launch left files behind", err, entries)
	}
}

type failingReader struct{ err error }

func (r failingReader) Read([]byte) (int, error) { return 0, r.err }
