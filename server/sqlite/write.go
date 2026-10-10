package sqlite

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"github.com/futsuuu/ku-potato/server/domain"
	"github.com/futsuuu/ku-potato/server/sqlite/internal/gen/model"
	"github.com/futsuuu/ku-potato/server/sqlite/internal/gen/table"
	"github.com/go-jet/jet/v2/qrm"
	"github.com/go-jet/jet/v2/sqlite"
)

func (s *Store) Append(ctx context.Context, snapshot domain.Snapshot) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if snapshot.Courses != nil {
		if err := insertCourses(ctx, tx, snapshot.Courses); err != nil {
			return err
		}
	}
	if snapshot.Materials != nil {
		if err := insertMaterials(ctx, tx, *snapshot.Materials); err != nil {
			return err
		}
	}
	// nil means the resource list was not fetched (for example, a private material).
	// A non-nil empty slice is a successfully fetched, empty list.
	if snapshot.MaterialID != "" && snapshot.Resources != nil {
		if err := insertResources(ctx, tx, snapshot.MaterialID, snapshot.Resources); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func insertCourses(ctx context.Context, tx *sql.Tx, courses []domain.Course) error {
	r := table.CourseRetrievals
	result, err := r.INSERT(r.FetchedAt).MODEL(model.CourseRetrievals{FetchedAt: time.Now().UnixMilli()}).ExecContext(ctx, tx)
	if err != nil {
		return err
	}
	id, err := result.LastInsertId()
	if err != nil {
		return err
	}
	t := table.Courses
	for position, course := range courses {
		row := model.Courses{RetrievalID: id, Position: int64(position), Name: course.Name, Availability: course.Availability}
		if course.ID != "" {
			row.LmsCourseID = &course.ID
		}
		if _, err := t.INSERT(t.AllColumns).MODEL(row).ExecContext(ctx, tx); err != nil {
			return err
		}
	}
	return nil
}

func insertMaterials(ctx context.Context, tx *sql.Tx, materials domain.CourseMaterials) error {
	r := table.CourseMaterialRetrievals
	result, err := r.INSERT(r.LmsCourseID, r.FetchedAt).MODEL(model.CourseMaterialRetrievals{
		LmsCourseID: materials.CourseID, FetchedAt: time.Now().UnixMilli(),
	}).ExecContext(ctx, tx)
	if err != nil {
		return err
	}
	id, err := result.LastInsertId()
	if err != nil {
		return err
	}
	f := table.CourseMaterialFolders
	t := table.CourseMaterials
	position := int64(0)
	for folderPosition, folder := range materials.Folders {
		if _, err := f.INSERT(f.AllColumns).MODEL(model.CourseMaterialFolders{
			RetrievalID: id, Position: int64(folderPosition), Name: folder.Name, ClassDate: folder.ClassDate,
		}).ExecContext(ctx, tx); err != nil {
			return err
		}
		for _, material := range folder.Materials {
			row := model.CourseMaterials{
				RetrievalID: id, Position: position, FolderPosition: int64(folderPosition),
				LmsMaterialID: material.ID, Name: material.Name, Type: material.Type,
				PublicationDeadline: material.PublicationDeadline, ResourceAvailability: material.ResourceAvailability,
			}
			if _, err := t.INSERT(t.AllColumns).MODEL(row).ExecContext(ctx, tx); err != nil {
				return err
			}
			position++
		}
	}
	return nil
}

func insertResources(ctx context.Context, tx *sql.Tx, material string, resources []domain.Resource) error {
	r := table.MaterialResourceRetrievals
	result, err := r.INSERT(r.LmsMaterialID, r.FetchedAt).MODEL(model.MaterialResourceRetrievals{
		LmsMaterialID: material, FetchedAt: time.Now().UnixMilli(),
	}).ExecContext(ctx, tx)
	if err != nil {
		return err
	}
	id, err := result.LastInsertId()
	if err != nil {
		return err
	}
	t := table.MaterialResources
	state := table.ResourceStates
	for position, resource := range resources {
		if _, err := t.INSERT(t.AllColumns).MODEL(model.MaterialResources{
			RetrievalID: id, Position: int64(position), LmsResourceID: resource.ID,
			Name: resource.Name, Type: resource.Type, SourceKind: resource.SourceKind, URL: resource.URL,
		}).ExecContext(ctx, tx); err != nil {
			return err
		}
		if _, err := state.INSERT(state.LmsMaterialID, state.LmsResourceID).MODEL(model.ResourceStates{
			LmsMaterialID: material, LmsResourceID: resource.ID,
		}).ON_CONFLICT(state.LmsMaterialID, state.LmsResourceID).DO_NOTHING().ExecContext(ctx, tx); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) Acquired(ctx context.Context, material, resource string, file *domain.SavedFile, failure error) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	t := table.ResourceStates
	key := t.LmsMaterialID.EQ(sqlite.String(material)).AND(t.LmsResourceID.EQ(sqlite.String(resource)))
	var row model.ResourceStates
	if err := t.SELECT(t.AllColumns).WHERE(key).QueryContext(ctx, tx, &row); err != nil {
		if errors.Is(err, qrm.ErrNoRows) {
			return domain.ErrMissing
		}
		return err
	}
	now, status, message := time.Now().UnixMilli(), "success", ""
	row.LastAttemptAt, row.LastAttemptStatus, row.LastAttemptError = &now, &status, &message
	if failure == nil {
		row.LastSucceededAt = &now
		if file != nil {
			row.FileID, row.OriginalFilename, row.Sha256, row.FileSize = &file.ID, &file.OriginalFilename, &file.SHA256, &file.Size
		}
	} else {
		status, message = "failure", publicError(failure).Message
	}
	if _, err := t.UPDATE(t.MutableColumns).MODEL(row).WHERE(key).ExecContext(ctx, tx); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) Auth(ctx context.Context) (domain.AuthState, error) {
	t := table.AuthenticationState
	var row model.AuthenticationState
	err := t.SELECT(t.AllColumns).WHERE(t.ID.EQ(sqlite.Int(1))).QueryContext(ctx, s.db, &row)
	if errors.Is(err, qrm.ErrNoRows) {
		return domain.AuthState{Status: "unknown"}, nil
	}
	if err != nil {
		return domain.AuthState{}, err
	}
	return domain.AuthState{Status: row.Status, CheckedAt: millisTime(&row.CheckedAt)}, nil
}

func (s *Store) SetAuth(ctx context.Context, status string) error {
	t := table.AuthenticationState
	_, err := t.INSERT(t.AllColumns).MODEL(model.AuthenticationState{ID: 1, Status: status, CheckedAt: time.Now().UnixMilli()}).
		ON_CONFLICT(t.ID).DO_UPDATE(sqlite.SET(t.Status.SET(t.EXCLUDED.Status), t.CheckedAt.SET(t.EXCLUDED.CheckedAt))).ExecContext(ctx, s.db)
	return err
}
