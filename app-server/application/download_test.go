package application

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	"github.com/futsuuu/ku-potato/app-server/application/outport"
	"github.com/futsuuu/ku-potato/app-server/domain"
	"github.com/futsuuu/ku-potato/app-server/filesystem"
	"github.com/futsuuu/ku-potato/app-server/googledrive"
)

const (
	cachedDriveURL = "https://drive.google.com/file/d/old/view?resourcekey=key"
	latestDriveURL = "https://docs.google.com/presentation/d/old/edit?resourcekey=key&usp=sharing"
)

type downloadSource struct {
	outport.ContentSource
	fetch func(context.Context) (outport.Download, error)
}

func (s downloadSource) Download(ctx context.Context, _, _, _ string) (outport.Download, error) {
	return s.fetch(ctx)
}

type transferSource struct {
	transfer func(context.Context, string) (string, string, error)
}

func (d transferSource) Key(url string) (string, bool) {
	return googledrive.New(nil, "").Key(url)
}

func (d transferSource) Download(ctx context.Context, url string) (string, string, error) {
	return d.transfer(ctx, url)
}

func transferFixture(
	t *testing.T,
	root string,
	source downloadSource,
	downloader transferSource,
) *Application {
	t.Helper()
	files, err := filesystem.New(filepath.Join(root, "files"))
	if err != nil {
		t.Fatal(err)
	}
	return New(source, nil, nil, files, time.Second, 1, WithExternalDownloader(downloader))
}

func TestSpeculativeTransferOverlapsRefreshAndReusesMatchingFile(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	started, refreshed := make(chan struct{}), make(chan struct{})
	var calls atomic.Int32
	root := t.TempDir()
	app := transferFixture(
		t,
		root,
		downloadSource{fetch: func(context.Context) (outport.Download, error) {
			<-started
			close(refreshed)
			return outport.Download{
				URL:      latestDriveURL,
				Snapshot: domain.Snapshot{MaterialID: "SRY1"},
			}, nil
		}},
		transferSource{transfer: func(ctx context.Context, url string) (string, string, error) {
			calls.Add(1)
			if url != cachedDriveURL {
				t.Errorf("unexpected transfer URL: %s", url)
			}
			close(started)
			select {
			case <-refreshed:
			case <-ctx.Done():
				return "", "", ctx.Err()
			}
			path := filepath.Join(root, "staging")
			return path, "old.pdf", os.WriteFile(path, []byte("file"), 0o600)
		}},
	)
	got, err := app.downloadFromSource(ctx, "SRY1", "SRS1", "KOG1", cachedDriveURL)
	if err != nil || got.URL != "" || got.Filename != "old.pdf" ||
		got.Snapshot.MaterialID != "SRY1" ||
		calls.Load() != 1 {
		t.Fatal(got, err, calls.Load())
	}
	if body, err := os.ReadFile(got.Path); err != nil || string(body) != "file" {
		t.Fatal("matching file was not retained", err)
	}
}

func TestSpeculativeTransferDiscardsChangedURLAndFetchesLatest(t *testing.T) {
	for _, latest := range []string{"https://drive.google.com/file/d/new/view", "https://drive.google.com/file/d/old/view?resourcekey=changed"} {
		t.Run(latest, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			started, canceled := make(chan struct{}), make(chan struct{})
			root := t.TempDir()
			app := transferFixture(
				t,
				root,
				downloadSource{fetch: func(context.Context) (outport.Download, error) {
					<-started
					return outport.Download{URL: latest}, nil
				}},
				transferSource{
					transfer: func(ctx context.Context, url string) (string, string, error) {
						if url == cachedDriveURL {
							close(started)
							<-ctx.Done()
							close(canceled)
							return "", "", ctx.Err()
						}
						if url != latest {
							t.Errorf("wrong latest URL: %s", url)
						}
						path := filepath.Join(root, "latest")
						return path, "latest.pdf", os.WriteFile(path, []byte("latest"), 0o600)
					},
				},
			)
			got, err := app.downloadFromSource(ctx, "SRY1", "SRS1", "", cachedDriveURL)
			if err != nil || got.URL != "" || got.Filename != "latest.pdf" {
				t.Fatal(got, err)
			}
			select {
			case <-canceled:
			default:
				t.Fatal("obsolete transfer was not canceled")
			}
		})
	}
}

func TestSpeculativeTransferDiscardsCompletedFileOnFailureOrTypeChange(t *testing.T) {
	for _, test := range []struct {
		name    string
		current outport.Download
		err     error
	}{
		{name: "source failure", err: domain.Fail("source", "LMS unavailable")},
		{name: "native file", current: outport.Download{Path: "native"}},
		{name: "unsupported URL", current: outport.Download{URL: "https://example.com/file"}},
	} {
		t.Run(test.name, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			completed := make(chan struct{})
			root := t.TempDir()
			app := transferFixture(
				t,
				root,
				downloadSource{fetch: func(context.Context) (outport.Download, error) {
					<-completed
					return test.current, test.err
				}},
				transferSource{transfer: func(context.Context, string) (string, string, error) {
					path := filepath.Join(root, "obsolete")
					if err := os.WriteFile(path, []byte("old"), 0o600); err != nil {
						return "", "", err
					}
					close(completed)
					return path, "old.pdf", nil
				}},
			)
			got, err := app.downloadFromSource(ctx, "SRY1", "SRS1", "", cachedDriveURL)
			if !errors.Is(err, test.err) || got.Path != test.current.Path ||
				got.URL != test.current.URL {
				t.Fatal(got, err)
			}
			if _, err := os.Stat(filepath.Join(root, "obsolete")); !os.IsNotExist(err) {
				t.Fatal("obsolete file was retained", err)
			}
		})
	}
}

func TestUnsupportedCachedURLUsesLatestExternalURL(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	for _, cached := range []string{"", "https://example.com/old"} {
		t.Run(cached, func(t *testing.T) {
			var refreshed atomic.Bool
			app := transferFixture(
				t,
				t.TempDir(),
				downloadSource{fetch: func(context.Context) (outport.Download, error) {
					refreshed.Store(true)
					return outport.Download{URL: latestDriveURL}, nil
				}},
				transferSource{
					transfer: func(_ context.Context, url string) (string, string, error) {
						if !refreshed.Load() || url != latestDriveURL {
							t.Errorf("transfer started before refresh or used stale URL: %s", url)
						}
						return "", "", nil
					},
				},
			)
			got, err := app.downloadFromSource(ctx, "SRY1", "SRS1", "", cached)
			if err != nil || got.URL != latestDriveURL || got.Path != "" {
				t.Fatal(got, err)
			}
		})
	}
}

func TestSpeculativeTransferCancellationCleansUp(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	started, canceled := make(chan struct{}), make(chan struct{})
	root := t.TempDir()
	app := transferFixture(
		t,
		root,
		downloadSource{fetch: func(context.Context) (outport.Download, error) {
			<-started
			cancel()
			return outport.Download{}, ctx.Err()
		}},
		transferSource{transfer: func(ctx context.Context, _ string) (string, string, error) {
			path := filepath.Join(root, "partial")
			if err := os.WriteFile(path, []byte("partial"), 0o600); err != nil {
				return "", "", err
			}
			close(started)
			<-ctx.Done()
			close(canceled)
			return path, "partial.pdf", ctx.Err()
		}},
	)
	_, err := app.downloadFromSource(ctx, "SRY1", "SRS1", "", cachedDriveURL)
	if !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
	select {
	case <-canceled:
	default:
		t.Fatal("transfer did not stop")
	}
	if _, err := os.Stat(filepath.Join(root, "partial")); !os.IsNotExist(err) {
		t.Fatal("partial file remained", err)
	}
}
