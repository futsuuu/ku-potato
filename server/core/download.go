package core

import (
	"context"
	"errors"
	"log/slog"

	"github.com/futsuuu/ku-potato/server/core/operation"
	"github.com/futsuuu/ku-potato/server/core/outport"
	"github.com/futsuuu/ku-potato/server/domain"
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
	download, err := a.content.Download(ctx, r.MaterialID, r.ResourceID, preferred, cachedURL)
	if download.Path != "" {
		defer func() {
			if e := a.files.Discard(download.Path); e != nil {
				slog.Error("discard download", "error", e)
			}
		}()
	}
	var observations outport.ObservationIDs
	if download.Snapshot.MaterialID != "" {
		var e error
		if observations, e = a.append(ctx, download.Snapshot); e != nil {
			return nil, e
		}
	}
	if err != nil {
		if e := a.archive.Acquired(ctx, r.MaterialID, r.ResourceID, observations.Resources, nil, err); e != nil {
			slog.Error("record acquisition failure", "error", e)
		}
		return nil, err
	}
	if download.URL != "" {
		return domain.DownloadResult{Type: "external", URL: download.URL}, a.archive.Acquired(ctx, r.MaterialID, r.ResourceID, observations.Resources, nil, nil)
	}
	report(ctx, operation.Progress{Stage: "saving"})
	file, err := a.files.Save(download.Path, download.Filename)
	if err != nil {
		return nil, err
	}
	detail, err := a.archive.Detail(ctx, r.MaterialID)
	if err != nil {
		_ = a.files.Remove(file)
		return nil, err
	}
	var previous *domain.SavedFile
	for _, res := range detail.Resources {
		if res.ID == r.ResourceID {
			previous = res.SavedFile
		}
	}
	if err = a.archive.Acquired(ctx, r.MaterialID, r.ResourceID, observations.Resources, &file, nil); err != nil {
		_ = a.files.Remove(file)
		return nil, err
	}
	if previous != nil && previous.ID != file.ID {
		if e := a.files.Remove(*previous); e != nil {
			slog.Error("remove superseded resource", "error", e)
		}
	}
	return domain.DownloadResult{Type: "file", File: &file}, nil
}
