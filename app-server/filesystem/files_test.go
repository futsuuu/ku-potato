package filesystem

import (
	"bytes"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/futsuuu/ku-potato/app-server/domain"
)

func TestSaveKeepsCommonCompressedFormatsUnchanged(t *testing.T) {
	dir := t.TempDir()
	files, err := New(filepath.Join(dir, "resources"))
	if err != nil {
		t.Fatal(err)
	}
	// The contents are deliberately compressible: the decision uses the filename.
	body := []byte(strings.Repeat("archive payload", 100))
	source := filepath.Join(dir, "download")
	if err := os.WriteFile(source, body, 0o600); err != nil {
		t.Fatal(err)
	}
	for _, filename := range []string{"bundle.ZIP", "slides.PPTX", "sheet.xlsx", "photo.jpg", "clip.mp4", "archive.zst"} {
		t.Run(filename, func(t *testing.T) {
			saved, err := files.Save(source, filename)
			if err != nil {
				t.Fatal(err)
			}
			if strings.HasSuffix(saved.ID, zstdSuffix) || saved.Size != int64(len(body)) ||
				saved.OriginalFilename != filename {
				t.Fatal(saved)
			}
			stored, err := os.ReadFile(filepath.Join(dir, "resources", saved.ID))
			if err != nil || !bytes.Equal(stored, body) {
				t.Fatal("stored bytes changed", err)
			}
			file, err := files.Open(saved)
			if err != nil {
				t.Fatal(err)
			}
			opened, err := io.ReadAll(file)
			_ = file.Close()
			if err != nil || !bytes.Equal(opened, body) {
				t.Fatal("opened bytes changed", err)
			}
			if err := files.Remove(saved); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestSaveUsesOriginalSHA256AsIdentity(t *testing.T) {
	dir := t.TempDir()
	files, err := New(filepath.Join(dir, "resources"))
	if err != nil {
		t.Fatal(err)
	}
	source := filepath.Join(dir, "download")
	if err = os.WriteFile(source, []byte("hello"), 0o600); err != nil {
		t.Fatal(err)
	}
	saved, err := files.Save(source, "../../CON.txt")
	if err != nil {
		t.Fatal(err)
	}
	if saved.ID != saved.SHA256 || saved.Size != 5 ||
		saved.SHA256 != "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824" {
		t.Fatal(saved)
	}
	stored, err := os.ReadFile(filepath.Join(dir, "resources", saved.ID+zstdSuffix))
	if err != nil || len(stored) < 4 || string(stored[:4]) != "\x28\xb5\x2f\xfd" {
		t.Fatal("saved data is not a zstd frame", err)
	}
	file, err := files.Open(saved)
	if err != nil {
		t.Fatal(err)
	}
	body, err := io.ReadAll(file)
	_ = file.Close()
	if err != nil || string(body) != "hello" {
		t.Fatal(string(body), err)
	}
	if _, err = files.Open(domain.SavedFile{ID: strings.Repeat("../", 10)}); err == nil {
		t.Fatal("accepted traversal")
	}
	if err = files.Remove(saved); err != nil {
		t.Fatal(err)
	}
}

func TestCompressedFileSupportsSeeking(t *testing.T) {
	dir := t.TempDir()
	files, err := New(filepath.Join(dir, "resources"))
	if err != nil {
		t.Fatal(err)
	}
	body := []byte(strings.Repeat("lecture notes and examples\n", 1000))
	source := filepath.Join(dir, "download")
	if err := os.WriteFile(source, body, 0o600); err != nil {
		t.Fatal(err)
	}
	saved, err := files.Save(source, "paper.PDF")
	if err != nil {
		t.Fatal(err)
	}
	stat, err := os.Stat(filepath.Join(dir, "resources", saved.ID+zstdSuffix))
	if err != nil || stat.Size() >= saved.Size {
		t.Fatal("repetitive data did not compress", stat, saved, err)
	}
	file, err := files.Open(saved)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = file.Close() }()
	if end, err := file.Seek(0, io.SeekEnd); err != nil || end != int64(len(body)) {
		t.Fatal("wrong original size", end, err)
	}
	if _, err := file.Seek(0, io.SeekStart); err != nil {
		t.Fatal(err)
	}
	first := make([]byte, 20)
	if _, err := io.ReadFull(file, first); err != nil || string(first) != string(body[:20]) {
		t.Fatal("initial read failed", string(first), err)
	}
	if _, err := file.Seek(-10, io.SeekCurrent); err != nil {
		t.Fatal(err)
	}
	again := make([]byte, 10)
	if _, err := io.ReadFull(file, again); err != nil || string(again) != string(body[10:20]) {
		t.Fatal("backward seek failed", string(again), err)
	}
	if _, err := file.Seek(-5, io.SeekEnd); err != nil {
		t.Fatal(err)
	}
	last, err := io.ReadAll(file)
	if err != nil || string(last) != string(body[len(body)-5:]) {
		t.Fatal("end-relative seek failed", string(last), err)
	}
	served, err := files.Open(saved)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = served.Close() }()
	request := httptest.NewRequest(http.MethodGet, "/file", nil)
	request.Header.Set("Range", "bytes=10-19")
	response := httptest.NewRecorder()
	http.ServeContent(response, request, saved.OriginalFilename, time.Time{}, served)
	if response.Code != http.StatusPartialContent || response.Body.String() != string(body[10:20]) {
		t.Fatal("range request did not serve original bytes", response.Code, response.Body.String())
	}
}

func TestUncompressedContentIDRemainsReadable(t *testing.T) {
	dir := t.TempDir()
	files, err := New(dir)
	if err != nil {
		t.Fatal(err)
	}
	legacy := domain.SavedFile{ID: strings.Repeat("a", 64), Size: 6}
	if err := os.WriteFile(filepath.Join(dir, legacy.ID), []byte("legacy"), 0o600); err != nil {
		t.Fatal(err)
	}
	file, err := files.Open(legacy)
	if err != nil {
		t.Fatal(err)
	}
	body, err := io.ReadAll(file)
	_ = file.Close()
	if err != nil || string(body) != "legacy" {
		t.Fatal(string(body), err)
	}
	if err := files.Remove(legacy); err != nil {
		t.Fatal(err)
	}
	if _, err := files.Open(domain.SavedFile{ID: legacy.ID + ".zip"}); err == nil {
		t.Fatal("accepted unsupported storage format")
	}
}
