package sqlite

import (
	"context"
	"errors"

	"github.com/futsuuu/ku-potato/app-server/domain"
	"github.com/futsuuu/ku-potato/app-server/sqlite/gen/model"
	"github.com/futsuuu/ku-potato/app-server/sqlite/gen/table"
	"github.com/go-jet/jet/v2/qrm"
	"github.com/go-jet/jet/v2/sqlite"
)

func savedFile(row model.SavedResources) domain.SavedFile {
	return domain.SavedFile{
		ID:               row.FileID,
		OriginalFilename: row.OriginalFilename,
		SHA256:           row.Sha256,
		Size:             row.FileSize,
	}
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
	t := table.SavedResources
	var row model.SavedResources
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
	row := model.SavedResources{
		LmsMaterialID:       material,
		LmsResourceID:       resource,
		FileID:              file.ID,
		OriginalFilename:    file.OriginalFilename,
		Sha256:              file.SHA256,
		FileSize:            file.Size,
		ResourceRetrievalID: retrievalID,
	}
	t := table.SavedResources
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
