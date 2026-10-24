package sqlite

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"github.com/futsuuu/ku-potato/server/core/outport"
	"github.com/futsuuu/ku-potato/server/domain"
	"github.com/futsuuu/ku-potato/server/sqlite/internal/gen/model"
	"github.com/futsuuu/ku-potato/server/sqlite/internal/gen/table"
	"github.com/go-jet/jet/v2/qrm"
	"github.com/go-jet/jet/v2/sqlite"
)

func (s *Store) Append(ctx context.Context, snapshot domain.Snapshot) (ids outport.ObservationIDs, err error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return ids, err
	}
	defer tx.Rollback()
	if snapshot.Courses != nil {
		if ids.Courses, err = insertCourses(ctx, tx, snapshot.AcademicYear, snapshot.Courses); err != nil {
			return outport.ObservationIDs{}, err
		}
	}
	if snapshot.Materials != nil {
		if ids.Materials, err = insertMaterials(ctx, tx, *snapshot.Materials); err != nil {
			return outport.ObservationIDs{}, err
		}
	}
	// nil means the resource list was not fetched (for example, a private material).
	// A non-nil empty slice is a successfully fetched, empty list.
	if snapshot.MaterialID != "" && snapshot.Resources != nil {
		if ids.Resources, err = insertResources(ctx, tx, snapshot.MaterialID, snapshot.Resources); err != nil {
			return outport.ObservationIDs{}, err
		}
	}
	if snapshot.Report != nil {
		if snapshot.MaterialID == "" {
			return outport.ObservationIDs{}, domain.Fail("invalid-input", "report detail requires a material ID")
		}
		if ids.Report, err = insertReport(ctx, tx, snapshot.MaterialID, *snapshot.Report); err != nil {
			return outport.ObservationIDs{}, err
		}
	}
	if err := tx.Commit(); err != nil {
		return outport.ObservationIDs{}, err
	}
	return ids, nil
}

func insertCourses(ctx context.Context, tx *sql.Tx, year int, courses []domain.Course) (int64, error) {
	r := table.CourseRetrievals
	result, err := r.INSERT(r.FetchedAt, r.AcademicYear).MODEL(model.CourseRetrievals{FetchedAt: time.Now().UnixMilli(), AcademicYear: int64(year)}).ExecContext(ctx, tx)
	if err != nil {
		return 0, err
	}
	id, err := result.LastInsertId()
	if err != nil {
		return 0, err
	}
	t := table.Courses
	for position, course := range courses {
		row := model.Courses{RetrievalID: id, Position: int64(position), Name: course.Name, Availability: course.Availability}
		row.Type, row.Weekday, row.Period = lecture(course)
		if course.ID != "" {
			row.LmsCourseID = &course.ID
		}
		if _, err := t.INSERT(t.AllColumns).MODEL(row).ExecContext(ctx, tx); err != nil {
			return 0, err
		}
	}
	return id, nil
}

func insertMaterials(ctx context.Context, tx *sql.Tx, materials domain.CourseMaterials) (int64, error) {
	r := table.CourseMaterialRetrievals
	result, err := r.INSERT(r.LmsCourseID, r.FetchedAt).MODEL(model.CourseMaterialRetrievals{
		LmsCourseID: materials.CourseID, FetchedAt: time.Now().UnixMilli(),
	}).ExecContext(ctx, tx)
	if err != nil {
		return 0, err
	}
	id, err := result.LastInsertId()
	if err != nil {
		return 0, err
	}
	f := table.CourseMaterialFolders
	t := table.CourseMaterials
	position := int64(0)
	for folderPosition, folder := range materials.Folders {
		if _, err := f.INSERT(f.AllColumns).MODEL(model.CourseMaterialFolders{
			RetrievalID: id, Position: int64(folderPosition), Name: folder.Name, ClassDate: folderDate(folder), DescriptionHTML: folder.DescriptionHTML,
		}).ExecContext(ctx, tx); err != nil {
			return 0, err
		}
		for _, material := range folder.Materials {
			row := model.CourseMaterials{
				RetrievalID: id, Position: position, FolderPosition: int64(folderPosition),
				LmsMaterialID: material.ID, Name: material.Name,
				MaterialLinkAvailable: boolInt(material.MaterialLinkAvailable), ResourceAvailability: material.ResourceAvailability,
			}
			row.Type = enumValue(material.ID, "type", material.Type, "material", "report", "test", "questionnaire", "e-learning", "board", "feedback")
			row.Status = materialStatus(material.ID, row.Type, material.Status)
			row.PublicationDeadlineKind, row.PublicationDeadlineAt = deadline(material)
			if _, err := t.INSERT(t.AllColumns).MODEL(row).ExecContext(ctx, tx); err != nil {
				return 0, err
			}
			position++
		}
	}
	return id, nil
}

func insertResources(ctx context.Context, tx *sql.Tx, material string, resources []domain.Resource) (int64, error) {
	r := table.MaterialResourceRetrievals
	result, err := r.INSERT(r.LmsMaterialID, r.FetchedAt).MODEL(model.MaterialResourceRetrievals{
		LmsMaterialID: material, FetchedAt: time.Now().UnixMilli(),
	}).ExecContext(ctx, tx)
	if err != nil {
		return 0, err
	}
	id, err := result.LastInsertId()
	if err != nil {
		return 0, err
	}
	t := table.MaterialResources
	state := table.ResourceStates
	for position, resource := range resources {
		if _, err := t.INSERT(t.AllColumns).MODEL(model.MaterialResources{
			RetrievalID: id, Position: int64(position), LmsResourceID: resource.ID,
			Name: resource.Name, Type: enumValue(resource.ID, "type", resource.Type, "file", "external"), URL: resource.URL,
			Status:        enumValue(resource.ID, "status", resource.Status, "unviewed", "viewed"),
			RegisteredOn:  dateOnly(resource.ID, "registered_on", resource.RegisteredOn),
			FirstViewedOn: dateOnly(resource.ID, "first_viewed_on", resource.FirstViewedOn), Description: resource.Description,
		}).ExecContext(ctx, tx); err != nil {
			return 0, err
		}
		if _, err := state.INSERT(state.LmsMaterialID, state.LmsResourceID).MODEL(model.ResourceStates{
			LmsMaterialID: material, LmsResourceID: resource.ID,
		}).ON_CONFLICT(state.LmsMaterialID, state.LmsResourceID).DO_NOTHING().ExecContext(ctx, tx); err != nil {
			return 0, err
		}
	}
	return id, nil
}

func (s *Store) Acquired(ctx context.Context, material, resource string, retrievalID int64, file *domain.SavedFile, failure error) error {
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
			row.SavedResourceRetrievalID = &retrievalID
		}
	} else {
		status, message = "failure", publicError(failure).Message
	}
	if _, err := t.UPDATE(t.MutableColumns).MODEL(row).WHERE(key).ExecContext(ctx, tx); err != nil {
		return err
	}
	return tx.Commit()
}
