package chromedp

import (
	"context"
	"log/slog"
	"os"

	"github.com/futsuuu/ku-potato/server/domain"
)

type pendingDownload struct {
	url     string
	cancel  context.CancelFunc
	result  chan downloadOutcome
	claimed bool
}

type downloadOutcome struct {
	path, filename string
	err            error
}

func beginDownload(ctx context.Context, rawURL string, acquire func(context.Context) (string, string, error)) *pendingDownload {
	ctx, cancel := context.WithCancel(ctx)
	pending := &pendingDownload{url: rawURL, cancel: cancel, result: make(chan downloadOutcome, 1)}
	go func() {
		path, filename, err := acquire(ctx)
		pending.result <- downloadOutcome{path: path, filename: filename, err: err}
	}()
	return pending
}

func (p *pendingDownload) matches(rawURL string) bool {
	old, ok := driveDownloadURL(p.url)
	current, currentOK := driveDownloadURL(rawURL)
	return ok && currentOK && old.String() == current.String()
}

func (p *pendingDownload) take() downloadOutcome {
	result := <-p.result
	p.claimed = true
	p.cancel()
	return result
}

// Cancellation alone is insufficient: the transfer might already have finished.
// Join it and remove any file whose ownership has not passed to the caller.
func (p *pendingDownload) discard() {
	if p == nil {
		return
	}
	p.cancel()
	if p.claimed {
		return
	}
	result := <-p.result
	p.claimed = true
	if result.path != "" {
		if err := os.Remove(result.path); err != nil && !os.IsNotExist(err) {
			slog.Error("discard speculative download", "error", err)
		}
	}
}

func downloadWithCachedURL(ctx context.Context, cachedURL string, refresh func(context.Context) (domain.Download, error), start func(context.Context, string) *pendingDownload) (domain.Download, error) {
	pending := start(ctx, cachedURL)
	defer func() { pending.discard() }()
	current, err := refresh(ctx)
	if err != nil || current.URL == "" {
		return current, err
	}
	if pending == nil || !pending.matches(current.URL) {
		pending.discard()
		pending = start(ctx, current.URL)
	}
	if pending == nil {
		return current, nil
	}
	result := pending.take()
	current.Path, current.Filename = result.path, result.filename
	if result.err == nil {
		current.URL = ""
	}
	return current, result.err
}

func (b *Browser) startDriveDownload(ctx context.Context, rawURL string) *pendingDownload {
	destination, supported := driveDownloadURL(rawURL)
	if !supported || b.google == nil {
		return nil
	}
	// Prepare the HTTP client before leasing an LMS page; the file transfer
	// itself needs no browser locks.
	d, err := b.google.driveClient(ctx)
	if err != nil {
		return beginDownload(ctx, rawURL, func(context.Context) (string, string, error) {
			return "", "", googleDownloadError(ctx, err)
		})
	}
	return beginDownload(ctx, rawURL, func(transfer context.Context) (string, string, error) {
		defer d.client.CloseIdleConnections()
		path, filename, err := d.download(transfer, destination, b.opts.DownloadDir)
		return path, filename, googleDownloadError(transfer, err)
	})
}
