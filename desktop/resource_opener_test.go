package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"mime"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSharedFilesOpensPreparedPathWithoutTransferringContent(t *testing.T) {
	path := filepath.Join(t.TempDir(), "資料.pdf")
	if err := os.WriteFile(path, []byte("saved bytes"), 0600); err != nil {
		t.Fatal(err)
	}
	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		if r.Method != http.MethodPost || r.URL.Path != "/materials/SRY1/resources/SRS1/prepare" {
			t.Error("unexpected request", r.Method, r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"data": map[string]string{"path": path}})
	}))
	defer server.Close()
	opener := resourceOpener{endpoint: server.URL, sharedFiles: true, tempDir: t.TempDir()}
	launches := 0
	if err := opener.open(context.Background(), "SRY1", "SRS1", func(opened string) error {
		launches++
		if opened != path {
			t.Error("did not use the server file", opened)
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	entries, err := os.ReadDir(opener.tempDir)
	if err != nil || len(entries) != 0 || requests != 1 || launches != 1 {
		t.Fatal("local open copied content or made extra requests", entries, requests, launches, err)
	}
	failed := errors.New("launch failed")
	if err := opener.open(context.Background(), "SRY1", "SRS1", func(string) error { return failed }); !errors.Is(err, failed) {
		t.Fatal("launch error was lost", err)
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatal("launch failure removed the server file", err)
	}
}

func TestRemoteConnectionTransfersBytesEvenOnLoopback(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/materials/SRY1/resources/SRS1/file" {
			t.Error("remote connection requested a local path", r.Method, r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": `..\資料.pdf`}))
		_, _ = w.Write([]byte("saved bytes"))
	}))
	defer server.Close()
	opener := resourceOpener{endpoint: server.URL, tempDir: t.TempDir()}
	var opened string
	if err := opener.open(context.Background(), "SRY1", "SRS1", func(path string) error {
		opened = path
		body, err := os.ReadFile(path)
		if err != nil || string(body) != "saved bytes" || filepath.Base(path) != "資料.pdf" || filepath.Dir(filepath.Dir(path)) != opener.tempDir {
			t.Error("incorrect downloaded file", path, string(body), err)
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if opened == "" {
		t.Fatal("viewer was not launched")
	}
	if _, err := os.Stat(opened); err != nil {
		t.Fatal("file was removed while the viewer could still need it", err)
	}
}

func TestRemoteFailuresNeverLaunchAndRemovePartialCopies(t *testing.T) {
	for _, failure := range []string{"missing", "incomplete", "redirect", "invalid-filename", "launch"} {
		t.Run(failure, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				switch failure {
				case "missing":
					w.WriteHeader(http.StatusNotFound)
					_, _ = w.Write([]byte(`{"error":{"message":"saved file is missing"}}`))
					return
				case "redirect":
					http.Redirect(w, r, "/unexpected", http.StatusFound)
					return
				case "invalid-filename":
					w.Header().Set("Content-Disposition", "attachment; filename=")
					return
				case "incomplete":
					w.Header().Set("Content-Length", "100")
				}
				w.Header().Set("Content-Disposition", `attachment; filename="file.txt"`)
				_, _ = w.Write([]byte("partial"))
			}))
			defer server.Close()
			opener := resourceOpener{endpoint: server.URL, tempDir: t.TempDir()}
			launches := 0
			err := opener.open(context.Background(), "SRY1", "SRS1", func(string) error {
				launches++
				return errors.New("no default application")
			})
			if err == nil || (failure != "launch" && launches != 0) {
				t.Fatal("failed download launched a viewer", err, launches)
			}
			if failure == "missing" && !strings.Contains(err.Error(), "saved file is missing") {
				t.Fatal("server error was lost", err)
			}
			if failure == "launch" && (launches != 1 || !strings.Contains(err.Error(), "no default application")) {
				t.Fatal("launch error was lost", err, launches)
			}
			entries, err := os.ReadDir(opener.tempDir)
			if err != nil || len(entries) != 0 {
				t.Fatal("failed open left files behind", entries, err)
			}
		})
	}
}

func TestSharedFilesRejectsInvalidPaths(t *testing.T) {
	for _, path := range []string{"", "relative.pdf", t.TempDir(), filepath.Join(t.TempDir(), "missing")} {
		t.Run(path, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				_ = json.NewEncoder(w).Encode(map[string]any{"data": map[string]string{"path": path}})
			}))
			defer server.Close()
			opener := resourceOpener{endpoint: server.URL, sharedFiles: true}
			if err := opener.open(context.Background(), "SRY1", "SRS1", func(string) error {
				t.Fatal("invalid local path was opened")
				return nil
			}); err == nil {
				t.Fatal("invalid local path was accepted")
			}
		})
	}
}

func TestCanceledDownloadNeverLaunches(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Disposition", `attachment; filename="file.txt"`)
		w.Header().Set("Content-Length", "100")
		_, _ = fmt.Fprint(w, "partial")
		w.(http.Flusher).Flush()
		cancel()
		<-r.Context().Done()
	}))
	defer server.Close()
	defer cancel()
	opener := resourceOpener{endpoint: server.URL, tempDir: t.TempDir()}
	if err := opener.open(ctx, "SRY1", "SRS1", func(string) error {
		t.Fatal("canceled download launched a viewer")
		return nil
	}); !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
	entries, err := os.ReadDir(opener.tempDir)
	if err != nil || len(entries) != 0 {
		t.Fatal("canceled download left files behind", entries, err)
	}
}
