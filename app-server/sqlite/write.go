package sqlite

import (
	"context"
	"database/sql"

	"github.com/futsuuu/ku-potato/app-server/application/outport"
	"github.com/futsuuu/ku-potato/app-server/domain"
	"github.com/futsuuu/ku-potato/app-server/sqlite/gen/model"
	"github.com/futsuuu/ku-potato/app-server/sqlite/gen/table"
	"github.com/google/uuid"
)

func (s *Store) Append(
	ctx context.Context,
	snapshot domain.Snapshot,
) (ids outport.RetrievalIDs, err error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return ids, err
	}
	defer func() { _ = tx.Rollback() }()
	timestamp, err := newRetrievalTimestamp(ctx, tx)
	if err != nil {
		return ids, err
	}
	if ids, err = insertSnapshot(ctx, tx, timestamp, snapshot); err != nil {
		return outport.RetrievalIDs{}, err
	}
	return ids, tx.Commit()
}

func insertSnapshot(
	ctx context.Context,
	tx *sql.Tx,
	timestamp retrievalTimestamp,
	snapshot domain.Snapshot,
) (ids outport.RetrievalIDs, err error) {
	if snapshot.Courses != nil {
		ids.Courses, err = insertCourses(
			ctx,
			tx,
			uuid.NewString(),
			timestamp,
			snapshot.AcademicYear,
			snapshot.Courses,
		)
		if err != nil {
			return ids, err
		}
	}
	if snapshot.Materials != nil {
		ids.Materials, err = insertMaterials(
			ctx,
			tx,
			uuid.NewString(),
			timestamp,
			*snapshot.Materials,
		)
		if err != nil {
			return ids, err
		}
	}
	if snapshot.Resources != nil {
		if snapshot.MaterialID == "" {
			return ids, domain.Fail("invalid-input", "resources require a material ID")
		}
		ids.Resources, err = insertResources(
			ctx,
			tx,
			uuid.NewString(),
			timestamp,
			snapshot.MaterialID,
			snapshot.Resources,
		)
		if err != nil {
			return ids, err
		}
	}
	if snapshot.Report != nil {
		if snapshot.MaterialID == "" {
			return ids, domain.Fail("invalid-input", "report detail requires a material ID")
		}
		ids.Report, err = insertReport(
			ctx,
			tx,
			uuid.NewString(),
			timestamp,
			snapshot.MaterialID,
			*snapshot.Report,
		)
	}
	return ids, err
}

func insertCourses(
	ctx context.Context,
	tx *sql.Tx,
	id string,
	timestamp retrievalTimestamp,
	year int,
	courses []domain.Course,
) (string, error) {
	r := table.CourseRetrievals
	_, err := r.INSERT(r.AllColumns).
		MODEL(model.CourseRetrievals{
			ID:               id,
			AcademicYear:     int64(year),
			RetrievedAt:      timestamp.RetrievedAt,
			TimestampMillis:  timestamp.TimestampMillis,
			TimestampCounter: timestamp.TimestampCounter,
		}).
		ExecContext(ctx, tx)
	if err != nil {
		return "", err
	}

	t := table.Courses
	for position, course := range courses {
		row := model.Courses{
			RetrievalID:  id,
			Position:     int64(position),
			Name:         course.Name,
			Availability: course.Availability,
		}
		row.Type, row.Weekday, row.Period = lecture(course)
		if course.ID != "" {
			row.LmsCourseID = &course.ID
		}
		if _, err := t.INSERT(t.AllColumns).MODEL(row).ExecContext(ctx, tx); err != nil {
			return "", err
		}
	}
	return id, nil
}

func insertMaterials(
	ctx context.Context,
	tx *sql.Tx,
	id string,
	timestamp retrievalTimestamp,
	materials domain.CourseMaterials,
) (string, error) {
	r := table.CourseMaterialRetrievals
	_, err := r.INSERT(r.AllColumns).MODEL(model.CourseMaterialRetrievals{
		ID:               id,
		LmsCourseID:      materials.CourseID,
		RetrievedAt:      timestamp.RetrievedAt,
		TimestampMillis:  timestamp.TimestampMillis,
		TimestampCounter: timestamp.TimestampCounter,
	}).ExecContext(ctx, tx)
	if err != nil {
		return "", err
	}

	f := table.CourseMaterialFolders
	t := table.CourseMaterials
	position := int64(0)
	for folderPosition, folder := range materials.Folders {
		if _, err := f.INSERT(f.AllColumns).MODEL(model.CourseMaterialFolders{
			RetrievalID:     id,
			Position:        int64(folderPosition),
			Name:            folder.Name,
			ClassDate:       folderDate(folder),
			DescriptionHTML: folder.DescriptionHTML,
		}).ExecContext(ctx, tx); err != nil {
			return "", err
		}
		for _, material := range folder.Materials {
			row := model.CourseMaterials{
				RetrievalID:           id,
				Position:              position,
				FolderPosition:        int64(folderPosition),
				LmsMaterialID:         material.ID,
				Name:                  material.Name,
				MaterialLinkAvailable: boolInt(material.MaterialLinkAvailable),
				ResourceAvailability:  material.ResourceAvailability,
			}
			row.Type = enumValue(
				material.ID,
				"type",
				material.Type,
				"material",
				"report",
				"test",
				"questionnaire",
				"e-learning",
				"board",
				"feedback",
			)
			row.Status = materialStatus(material.ID, row.Type, material.Status)
			row.PublicationDeadlineKind, row.PublicationDeadlineAt = deadline(material)
			if _, err := t.INSERT(t.AllColumns).MODEL(row).ExecContext(ctx, tx); err != nil {
				return "", err
			}
			position++
		}
	}
	return id, nil
}

func insertResources(
	ctx context.Context,
	tx *sql.Tx,
	id string,
	timestamp retrievalTimestamp,
	material string,
	resources []domain.RetrievedResource,
) (string, error) {
	r := table.MaterialResourceRetrievals
	_, err := r.INSERT(r.AllColumns).MODEL(model.MaterialResourceRetrievals{
		ID:               id,
		LmsMaterialID:    material,
		RetrievedAt:      timestamp.RetrievedAt,
		TimestampMillis:  timestamp.TimestampMillis,
		TimestampCounter: timestamp.TimestampCounter,
	}).ExecContext(ctx, tx)
	if err != nil {
		return "", err
	}

	t := table.MaterialResources
	for position, resource := range resources {
		if _, err := t.INSERT(t.AllColumns).MODEL(model.MaterialResources{
			RetrievalID:   id,
			Position:      int64(position),
			LmsResourceID: resource.ID,
			Name:          resource.Name,
			Type:          enumValue(resource.ID, "type", resource.Type, "file", "external"),
			URL:           resource.URL,
			Status:        enumValue(resource.ID, "status", resource.Status, "unviewed", "viewed"),
			RegisteredOn:  dateOnly(resource.ID, "registered_on", resource.RegisteredOn),
			FirstViewedOn: dateOnly(
				resource.ID,
				"first_viewed_on",
				resource.FirstViewedOn,
			),
			Description: resource.Description,
		}).ExecContext(ctx, tx); err != nil {
			return "", err
		}
	}
	return id, nil
}
