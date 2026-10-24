package chromedp

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	"github.com/futsuuu/ku-potato/server/core/outport"
	"github.com/futsuuu/ku-potato/server/domain"
)

const cachedDriveURL = "https://drive.google.com/file/d/old/view?resourcekey=key"
const newDriveURL = "https://drive.google.com/file/d/new/view"

func speculativeStarter(d *driveHTTP, directory string) func(context.Context, string) *pendingDownload {
	return func(ctx context.Context, raw string) *pendingDownload {
		destination, supported := driveDownloadURL(raw)
		if !supported {
			return nil
		}
		return beginDownload(ctx, raw, func(transfer context.Context) (string, string, error) {
			return d.download(transfer, destination, directory)
		})
	}
}

func refreshedDownload(raw string) outport.Download {
	return outport.Download{URL: raw, Snapshot: domain.Snapshot{
		MaterialID: "SRY1", Resources: []domain.Resource{{ID: "SRS1", Type: "external", URL: raw}},
	}}
}

func waitForSpeculation(t *testing.T, ctx context.Context, signal <-chan struct{}) {
	t.Helper()
	select {
	case <-signal:
	case <-ctx.Done():
		t.Fatal("speculative transfer did not overlap the resource refresh")
	}
}

func TestSpeculativeDownloadOverlapsRefreshAndReusesMatchingFile(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	started, refreshing := make(chan struct{}), make(chan struct{})
	var requests atomic.Int32
	body := "%PDF cached content"
	d := driveFixture(t, func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		close(started)
		select {
		case <-refreshing:
		case <-r.Context().Done():
			return
		}
		w.Header().Set("Content-Disposition", `attachment; filename="file.pdf"`)
		w.Header().Set("Content-Type", "application/pdf")
		fmt.Fprint(w, body)
	})
	// Viewer parameters and fragments do not change the downloadable file.
	currentURL := "https://docs.google.com/presentation/d/old/edit?resourcekey=key&usp=sharing#slide=id.first"
	current := refreshedDownload(currentURL)
	got, err := downloadWithCachedURL(ctx, cachedDriveURL, func(context.Context) (outport.Download, error) {
		waitForSpeculation(t, ctx, started)
		close(refreshing)
		return current, nil
	}, speculativeStarter(d, t.TempDir()))
	if err != nil {
		t.Fatal(err)
	}
	content, err := os.ReadFile(got.Path)
	if err != nil || string(content) != body || got.URL != "" || got.Filename != "file.pdf" || requests.Load() != 1 {
		t.Fatal("matching speculation was not reused", got, requests.Load(), err)
	}
	if got.Snapshot.Resources[0].URL != currentURL {
		t.Fatal("latest resource observation was lost", got.Snapshot)
	}
}

func TestSpeculativeDownloadCancelsOldURLAndFetchesChangedURL(t *testing.T) {
	for _, latestURL := range []string{newDriveURL, "https://drive.google.com/file/d/old/view?resourcekey=changed"} {
		t.Run(latestURL, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			started, cancelled := make(chan struct{}), make(chan struct{})
			var requests atomic.Int32
			d := driveFixture(t, func(w http.ResponseWriter, r *http.Request) {
				requests.Add(1)
				w.Header().Set("Content-Disposition", `attachment; filename="file.pdf"`)
				w.Header().Set("Content-Type", "application/pdf")
				if r.URL.Query().Get("id") == "old" && r.URL.Query().Get("resourcekey") == "key" {
					w.Header().Set("Content-Length", "1000000")
					fmt.Fprint(w, "%PDF obsolete")
					w.(http.Flusher).Flush()
					close(started)
					<-r.Context().Done()
					close(cancelled)
					return
				}
				fmt.Fprint(w, "%PDF latest")
			})
			dir := t.TempDir()
			got, err := downloadWithCachedURL(ctx, cachedDriveURL, func(context.Context) (outport.Download, error) {
				waitForSpeculation(t, ctx, started)
				return refreshedDownload(latestURL), nil
			}, speculativeStarter(d, dir))
			if err != nil {
				t.Fatal(err)
			}
			waitForSpeculation(t, ctx, cancelled)
			content, err := os.ReadFile(got.Path)
			files, _ := os.ReadDir(dir)
			if err != nil || string(content) != "%PDF latest" || len(files) != 1 || requests.Load() != 2 || got.Snapshot.Resources[0].URL != latestURL {
				t.Fatal("obsolete transfer was retained", got, files, requests.Load(), err)
			}
		})
	}
}

func TestCompletedSpeculationIsDiscardedUnlessLatestResourceMatches(t *testing.T) {
	missing := domain.Fail("resource-not-found", "resource was removed")
	refreshFailure := domain.Fail("source", "LMS refresh failed")
	for _, test := range []struct {
		name   string
		latest outport.Download
		err    error
	}{
		{"missing", outport.Download{Snapshot: domain.Snapshot{MaterialID: "SRY1"}}, missing},
		{"refresh-failed", outport.Download{}, refreshFailure},
		{"unsupported-link", refreshedDownload("https://example.org/resource"), nil},
		{"changed-type", outport.Download{Filename: "native.txt"}, nil},
	} {
		t.Run(test.name, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			dir := t.TempDir()
			completed := make(chan string, 1)
			start := func(ctx context.Context, raw string) *pendingDownload {
				if _, supported := driveDownloadURL(raw); !supported {
					return nil
				}
				return beginDownload(ctx, raw, func(context.Context) (string, string, error) {
					file, err := os.CreateTemp(dir, "completed-*")
					if err != nil {
						return "", "", err
					}
					file.Close()
					completed <- file.Name()
					return file.Name(), "old.pdf", nil
				})
			}
			latest := test.latest
			if test.name == "changed-type" {
				latest.Path = filepath.Join(dir, "native.txt")
				if err := os.WriteFile(latest.Path, []byte("native"), 0600); err != nil {
					t.Fatal(err)
				}
			}
			var obsolete string
			got, err := downloadWithCachedURL(ctx, cachedDriveURL, func(context.Context) (outport.Download, error) {
				select {
				case obsolete = <-completed:
				case <-ctx.Done():
					t.Fatal("speculation never completed")
				}
				return latest, test.err
			}, start)
			if !errors.Is(err, test.err) || got.URL != latest.URL || got.Path != latest.Path || got.Snapshot.MaterialID != latest.Snapshot.MaterialID {
				t.Fatal("latest result was replaced by speculation", got, err)
			}
			if _, err := os.Stat(obsolete); !os.IsNotExist(err) {
				t.Fatal("completed obsolete file was retained", err)
			}
			if latest.Path != "" {
				if _, err := os.Stat(latest.Path); err != nil {
					t.Fatal("latest native file was discarded", err)
				}
			}
		})
	}
}

func TestDownloadWithoutSupportedCacheUsesLatestURL(t *testing.T) {
	for _, cached := range []string{"", "https://example.org/resource"} {
		t.Run(cached, func(t *testing.T) {
			var refreshed atomic.Bool
			d := driveFixture(t, func(w http.ResponseWriter, r *http.Request) {
				if !refreshed.Load() || r.URL.Query().Get("id") != "new" {
					t.Error("download did not use the latest resource")
				}
				w.Header().Set("Content-Disposition", `attachment; filename="file.pdf"`)
				w.Header().Set("Content-Type", "application/pdf")
				fmt.Fprint(w, "%PDF latest")
			})
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			got, err := downloadWithCachedURL(ctx, cached, func(context.Context) (outport.Download, error) {
				refreshed.Store(true)
				return refreshedDownload(newDriveURL), nil
			}, speculativeStarter(d, t.TempDir()))
			if err != nil || got.Path == "" || got.URL != "" {
				t.Fatal(got, err)
			}
		})
	}
}

func TestSpeculativeDownloadCancellationStopsTransferAndRemovesPartialFile(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	started, cancelled := make(chan struct{}), make(chan struct{})
	d := driveFixture(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Disposition", `attachment; filename="file.pdf"`)
		w.Header().Set("Content-Type", "application/pdf")
		w.Header().Set("Content-Length", "1000000")
		fmt.Fprint(w, "%PDF partial")
		w.(http.Flusher).Flush()
		close(started)
		<-r.Context().Done()
		close(cancelled)
	})
	dir := t.TempDir()
	got, err := downloadWithCachedURL(ctx, cachedDriveURL, func(context.Context) (outport.Download, error) {
		waitForSpeculation(t, ctx, started)
		cancel()
		return outport.Download{}, ctx.Err()
	}, speculativeStarter(d, dir))
	if !errors.Is(err, context.Canceled) || got.Path != "" {
		t.Fatal(got, err)
	}
	select {
	case <-cancelled:
	case <-time.After(time.Second):
		t.Fatal("HTTP transfer was not cancelled")
	}
	files, _ := os.ReadDir(dir)
	if len(files) != 0 {
		t.Fatal("partial speculation was retained", files)
	}
}
