package sqlite

import (
	"context"
	"errors"
	"time"

	"github.com/futsuuu/ku-potato/app-server/domain"
	"github.com/futsuuu/ku-potato/app-server/sqlite/gen/model"
	"github.com/futsuuu/ku-potato/app-server/sqlite/gen/table"
	"github.com/go-jet/jet/v2/qrm"
	"github.com/go-jet/jet/v2/sqlite"
)

func savedFile(row model.SavedFiles) domain.SavedFile {
	return domain.SavedFile{
		ContentHash:      row.ContentHash,
		OriginalFilename: row.OriginalFilename,
		OriginalSize:     row.OriginalSize,
	}
}

func (s *Store) ReferencesContent(ctx context.Context, contentHash string) (bool, error) {
	t := table.SavedFiles
	var row struct{ Referenced bool }
	err := sqlite.SELECT(sqlite.EXISTS(t.SELECT(t.ContentHash).WHERE(t.ContentHash.EQ(sqlite.String(contentHash)))).AS("referenced")).
		QueryContext(ctx, s.db, &row)
	return row.Referenced, err
}

func (s *Store) SavedFile(
	ctx context.Context,
	material, resource string,
) (domain.SavedFile, error) {
	return findSavedFile(ctx, s.db, material, resource)
}

func findSavedFile(
	ctx context.Context,
	db qrm.DB,
	material, resource string,
) (domain.SavedFile, error) {
	t := table.SavedFiles
	var row model.SavedFiles
	err := t.SELECT(t.AllColumns).
		WHERE(t.LmsMaterialID.EQ(sqlite.String(material)).
			AND(t.LmsResourceID.EQ(sqlite.String(resource)))).
		QueryContext(ctx, db, &row)
	if errors.Is(err, qrm.ErrNoRows) {
		return domain.SavedFile{}, domain.ErrMissing
	}
	return savedFile(row), err
}

func (s *Store) ReplaceSavedFile(
	ctx context.Context,
	material, resource string,
	retrievalID string,
	file domain.SavedFile,
) (*domain.SavedFile, error) {
	if file.OriginalSize < 0 {
		return nil, domain.Fail("invalid-input", "invalid saved file metadata")
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()
	previous, err := findSavedFile(ctx, tx, material, resource)
	exists := err == nil
	if err != nil && !errors.Is(err, domain.ErrMissing) {
		return nil, err
	}
	timestamp, err := nextArchiveTimestamp(ctx, tx, time.Now().UnixMilli())
	if err != nil {
		return nil, err
	}
	row := model.SavedFiles{
		LmsMaterialID:       material,
		LmsResourceID:       resource,
		ContentHash:         file.ContentHash,
		OriginalFilename:    file.OriginalFilename,
		OriginalSize:        file.OriginalSize,
		ResourceRetrievalID: retrievalID,
		TimestampMillis:     timestamp.Millis,
		TimestampCounter:    timestamp.Counter,
	}
	t := table.SavedFiles
	if exists {
		_, err = t.UPDATE(t.MutableColumns).MODEL(row).
			WHERE(t.LmsMaterialID.EQ(sqlite.String(material)).
				AND(t.LmsResourceID.EQ(sqlite.String(resource)))).
			ExecContext(ctx, tx)
	} else {
		_, err = t.INSERT(t.AllColumns).MODEL(row).ExecContext(ctx, tx)
	}
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	if exists {
		return &previous, nil
	}
	return nil, nil
}
