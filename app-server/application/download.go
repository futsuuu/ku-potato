package application

import (
	"context"
	"errors"
	"log/slog"

	"github.com/futsuuu/ku-potato/app-server/application/operation"
	"github.com/futsuuu/ku-potato/app-server/application/outport"
	"github.com/futsuuu/ku-potato/app-server/domain"
)

func (a *Application) download(ctx context.Context, r operation.Request) (any, error) {
	preferred, err := a.archive.FindCourse(ctx, r.MaterialID)
	if err != nil {
		return nil, err
	}
	cachedURL := ""
	cached, err := a.archive.Detail(ctx, r.MaterialID)
	if err != nil && !errors.Is(err, domain.ErrMissing) {
		return nil, err
	}
	for _, resource := range cached.Resources {
		if resource.ID == r.ResourceID && resource.Type == "external" {
			cachedURL = resource.URL
			break
		}
	}
	report(ctx, operation.Progress{Stage: "downloading"})
	download, err := a.fetchDownload(ctx, r.MaterialID, r.ResourceID, preferred, cachedURL)
	if download.Path != "" {
		defer func() {
			if e := a.files.Discard(download.Path); e != nil {
				slog.Error("discard download", "error", e)
			}
		}()
	}
	var retrievals outport.RetrievalIDs
	if download.Snapshot.MaterialID != "" {
		var e error
		if retrievals, e = a.append(ctx, download.Snapshot); e != nil {
			return nil, e
		}
	}
	if err != nil {
		return nil, err
	}
	if download.URL != "" {
		return domain.DownloadResult{Type: "external", URL: download.URL}, nil
	}

	report(ctx, operation.Progress{Stage: "saving"})
	file, err := a.files.Save(download.Path, download.Filename)
	if err != nil {
		return nil, err
	}
	previous, err := a.archive.ReplaceSavedFile(
		ctx,
		r.MaterialID,
		r.ResourceID,
		retrievals.Resources,
		file,
	)
	if err != nil {
		if e := a.files.Remove(file); e != nil {
			slog.Error("remove uncommitted resource", "error", e)
		}
		return nil, err
	}
	if previous != nil && previous.ID != file.ID {
		if e := a.files.Remove(*previous); e != nil {
			slog.Error("remove superseded resource", "error", e)
		}
	}
	return domain.DownloadResult{Type: "file", File: &file}, nil
}

type transferResult struct {
	path, filename string
	err            error
}

type pendingTransfer struct {
	key    string
	cancel context.CancelFunc
	result chan transferResult
}

func (a *Application) startTransfer(ctx context.Context, rawURL string) *pendingTransfer {
	if a.external == nil {
		return nil
	}
	key, ok := a.external.Key(rawURL)
	if !ok {
		return nil
	}
	transfer, cancel := context.WithCancel(ctx)
	pending := &pendingTransfer{key: key, cancel: cancel, result: make(chan transferResult, 1)}
	go func() {
		path, filename, err := a.external.Download(transfer, rawURL)
		pending.result <- transferResult{path: path, filename: filename, err: err}
	}()
	return pending
}

func (a *Application) discardTransfer(pending *pendingTransfer) {
	if pending == nil {
		return
	}
	pending.cancel()
	result := <-pending.result
	if result.path != "" {
		if err := a.files.Discard(result.path); err != nil {
			slog.Error("discard speculative download", "error", err)
		}
	}
}

func (a *Application) fetchDownload(
	ctx context.Context,
	material, resource, preferred, cachedURL string,
) (outport.Download, error) {
	pending := a.startTransfer(ctx, cachedURL)
	defer func() { a.discardTransfer(pending) }()
	current, err := a.content.Download(ctx, material, resource, preferred)
	if err != nil || current.URL == "" {
		return current, err
	}
	key, supported := "", false
	if a.external != nil {
		key, supported = a.external.Key(current.URL)
	}
	if pending == nil || !supported || pending.key != key {
		a.discardTransfer(pending)
		pending = a.startTransfer(ctx, current.URL)
	}
	if pending == nil {
		return current, nil
	}
	result := <-pending.result
	pending.cancel()
	pending = nil
	current.Path, current.Filename = result.path, result.filename
	if result.path != "" && result.err == nil {
		current.URL = ""
	}
	return current, result.err
}
