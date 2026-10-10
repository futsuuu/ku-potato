package sqlite

import (
	"context"
	"database/sql"
	"errors"

	"github.com/futsuuu/ku-potato/server/domain"
	"github.com/futsuuu/ku-potato/server/sqlite/internal/gen/model"
	"github.com/futsuuu/ku-potato/server/sqlite/internal/gen/table"
	"github.com/go-jet/jet/v2/qrm"
	"github.com/go-jet/jet/v2/sqlite"
)

// Keep latest-retrieval lookups and their rows in the same database snapshot.
func readStore[T any](ctx context.Context, s *Store, load func(qrm.DB) (T, error)) (zero T, err error) {
	tx, err := s.db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return zero, err
	}
	defer tx.Rollback()
	return load(tx)
}

func latestID(ctx context.Context, db qrm.DB, query sqlite.SelectStatement) (int64, error) {
	var row struct{ ID int64 }
	err := query.QueryContext(ctx, db, &row)
	if errors.Is(err, qrm.ErrNoRows) {
		return 0, domain.ErrMissing
	}
	return row.ID, err
}

func (s *Store) Courses(ctx context.Context) ([]domain.Course, error) {
	return readStore(ctx, s, func(db qrm.DB) ([]domain.Course, error) { return courses(ctx, db) })
}

func courses(ctx context.Context, db qrm.DB) ([]domain.Course, error) {
	r := table.CourseRetrievals
	latest, err := latestID(ctx, db, r.SELECT(r.ID.AS("id")).ORDER_BY(r.ID.DESC()).LIMIT(1))
	if err != nil {
		return nil, err
	}
	t, history := table.Courses, table.Courses.AS("history")
	var rows []model.Courses
	err = t.SELECT(t.AllColumns).WHERE(t.RetrievalID.EQ(sqlite.Int(latest)).OR(
		t.LmsCourseID.IS_NOT_NULL().AND(sqlite.ROW(t.LmsCourseID, t.RetrievalID).IN(
			sqlite.SELECT(history.LmsCourseID, sqlite.MAX(history.RetrievalID)).FROM(history).GROUP_BY(history.LmsCourseID),
		)),
	)).ORDER_BY(t.RetrievalID.DESC(), t.Position.ASC()).QueryContext(ctx, db, &rows)
	if err != nil {
		return nil, err
	}
	result := []domain.Course{}
	seen := map[string]bool{}
	for _, row := range rows {
		course := domain.Course{Name: row.Name, Availability: row.Availability, Archived: row.RetrievalID != latest}
		if row.LmsCourseID != nil {
			course.ID = *row.LmsCourseID
			if row.RetrievalID != latest && seen[course.ID] {
				continue
			}
			seen[course.ID] = true
		}
		result = append(result, course)
	}
	return result, nil
}

func (s *Store) Materials(ctx context.Context, id string) (domain.CourseMaterials, error) {
	return readStore(ctx, s, func(db qrm.DB) (domain.CourseMaterials, error) { return materials(ctx, db, id) })
}

type materialRow struct {
	model.CourseMaterials
	model.CourseMaterialFolders
	model.CourseMaterialRetrievals
}

func materialHistory(ctx context.Context, db qrm.DB, course string, accessible bool) ([]materialRow, error) {
	t, r, f := table.CourseMaterials, table.CourseMaterialRetrievals, table.CourseMaterialFolders
	history, hr := t.AS("history"), r.AS("history_retrieval")
	condition := hr.LmsCourseID.EQ(sqlite.String(course))
	if accessible {
		condition = condition.AND(history.ResourceAvailability.NOT_EQ(sqlite.String("unavailable"))).
			AND(history.PublicationDeadline.NOT_EQ(sqlite.String("unavailable")))
	}
	latest := sqlite.SELECT(history.LmsMaterialID, sqlite.MAX(history.RetrievalID)).
		FROM(history.INNER_JOIN(hr, history.RetrievalID.EQ(hr.ID))).WHERE(condition).GROUP_BY(history.LmsMaterialID)
	var rows []materialRow
	err := t.SELECT(t.AllColumns, f.AllColumns, r.AllColumns).
		FROM(t.INNER_JOIN(r, t.RetrievalID.EQ(r.ID)).INNER_JOIN(f, t.RetrievalID.EQ(f.RetrievalID).AND(t.FolderPosition.EQ(f.Position)))).
		WHERE(r.LmsCourseID.EQ(sqlite.String(course)).AND(sqlite.ROW(t.LmsMaterialID, t.RetrievalID).IN(latest))).
		ORDER_BY(t.RetrievalID.DESC(), t.Position.ASC()).QueryContext(ctx, db, &rows)
	return rows, err
}

func materials(ctx context.Context, db qrm.DB, id string) (domain.CourseMaterials, error) {
	result := domain.CourseMaterials{CourseID: id, Folders: []domain.Folder{}}
	r := table.CourseMaterialRetrievals
	latest, err := latestID(ctx, db, r.SELECT(r.ID.AS("id")).WHERE(r.LmsCourseID.EQ(sqlite.String(id))).ORDER_BY(r.ID.DESC()).LIMIT(1))
	if err != nil {
		return result, err
	}
	knownCourses, err := courses(ctx, db)
	if err != nil && !errors.Is(err, domain.ErrMissing) {
		return result, err
	}
	courseArchived := false
	for _, course := range knownCourses {
		if course.ID == id {
			courseArchived = course.Archived || course.Availability == "unavailable"
		}
	}
	f := table.CourseMaterialFolders
	var folders []model.CourseMaterialFolders
	if err := f.SELECT(f.AllColumns).WHERE(f.RetrievalID.EQ(sqlite.Int(latest))).ORDER_BY(f.Position.ASC()).QueryContext(ctx, db, &folders); err != nil {
		return result, err
	}
	currentFolders := map[int64]int{}
	for _, folder := range folders {
		currentFolders[folder.Position] = len(result.Folders)
		result.Folders = append(result.Folders, domain.Folder{Name: folder.Name, ClassDate: folder.ClassDate, Materials: []domain.Material{}})
	}
	rows, err := materialHistory(ctx, db, id, false)
	if err != nil {
		return result, err
	}
	// Load accessible versions once, rather than issuing a query per private material.
	accessible, err := materialHistory(ctx, db, id, true)
	if err != nil {
		return result, err
	}
	byID := map[string]materialRow{}
	for _, row := range accessible {
		byID[row.LmsMaterialID] = row
	}
	for _, row := range rows {
		observation := row.CourseMaterials
		content := observation
		fetchedAt := row.FetchedAt
		private := observation.ResourceAvailability == "unavailable" || observation.PublicationDeadline == "unavailable"
		if private {
			// Preserve the last accessible metadata, while exposing the latest public state.
			if prior, ok := byID[observation.LmsMaterialID]; ok {
				content = prior.CourseMaterials
				fetchedAt = prior.FetchedAt
			}
		}
		material := domain.Material{
			ID: content.LmsMaterialID, Name: content.Name, Type: content.Type,
			PublicationDeadline: content.PublicationDeadline, ResourceAvailability: observation.ResourceAvailability,
			FetchedAt: millisTime(&fetchedAt),
			Archived:  courseArchived || observation.RetrievalID != latest || private,
		}
		index, current := currentFolders[observation.FolderPosition]
		if observation.RetrievalID != latest || !current {
			index = -1
			for i, folder := range result.Folders {
				if folder.Name == row.CourseMaterialFolders.Name && folder.ClassDate == row.ClassDate {
					index = i
					break
				}
			}
			if index < 0 {
				index = len(result.Folders)
				result.Folders = append(result.Folders, domain.Folder{Name: row.CourseMaterialFolders.Name, ClassDate: row.ClassDate, Materials: []domain.Material{}})
			}
		}
		result.Folders[index].Materials = append(result.Folders[index].Materials, material)
	}
	return result, nil
}

func (s *Store) FindCourse(ctx context.Context, material string) (string, error) {
	return readStore(ctx, s, func(db qrm.DB) (string, error) { return findCourse(ctx, db, material) })
}

func findCourse(ctx context.Context, db qrm.DB, material string) (string, error) {
	t, r := table.CourseMaterials, table.CourseMaterialRetrievals
	var row model.CourseMaterialRetrievals
	err := r.SELECT(r.AllColumns).FROM(r.INNER_JOIN(t, r.ID.EQ(t.RetrievalID))).
		WHERE(t.LmsMaterialID.EQ(sqlite.String(material))).ORDER_BY(r.ID.DESC()).LIMIT(1).QueryContext(ctx, db, &row)
	if errors.Is(err, qrm.ErrNoRows) {
		return "", nil
	}
	return row.LmsCourseID, err
}

func (s *Store) Detail(ctx context.Context, id string) (domain.Detail, error) {
	return readStore(ctx, s, func(db qrm.DB) (domain.Detail, error) {
		var result domain.Detail
		courseID, err := findCourse(ctx, db, id)
		if err != nil {
			return result, err
		}
		if courseID == "" {
			return result, domain.ErrMissing
		}
		known, err := courses(ctx, db)
		if err != nil {
			return result, err
		}
		for _, course := range known {
			if course.ID == courseID {
				result.Course = course
				break
			}
		}
		listing, err := materials(ctx, db, courseID)
		if err != nil {
			return result, err
		}
		found := false
		for _, folder := range listing.Folders {
			for _, material := range folder.Materials {
				if material.ID == id {
					result.Material = material
					found = true
				}
			}
		}
		if !found {
			return result, domain.ErrMissing
		}
		result.Resources, err = resources(ctx, db, id, result.Material.Archived || result.Material.ResourceAvailability == "unavailable")
		return result, err
	})
}

func resources(ctx context.Context, db qrm.DB, material string, archived bool) ([]domain.Resource, error) {
	r := table.MaterialResourceRetrievals
	latest, err := latestID(ctx, db, r.SELECT(r.ID.AS("id")).WHERE(r.LmsMaterialID.EQ(sqlite.String(material))).ORDER_BY(r.ID.DESC()).LIMIT(1))
	if errors.Is(err, domain.ErrMissing) && archived {
		return []domain.Resource{}, nil
	}
	if err != nil {
		return nil, err
	}
	t, state := table.MaterialResources, table.ResourceStates
	history, hr := t.AS("history"), r.AS("history_retrieval")
	latestPerResource := sqlite.SELECT(history.LmsResourceID, sqlite.MAX(history.RetrievalID)).
		FROM(history.INNER_JOIN(hr, history.RetrievalID.EQ(hr.ID))).
		WHERE(hr.LmsMaterialID.EQ(sqlite.String(material))).GROUP_BY(history.LmsResourceID)
	var rows []model.MaterialResources
	err = t.SELECT(t.AllColumns).FROM(t.INNER_JOIN(r, t.RetrievalID.EQ(r.ID))).
		WHERE(r.LmsMaterialID.EQ(sqlite.String(material)).AND(sqlite.ROW(t.LmsResourceID, t.RetrievalID).IN(latestPerResource))).
		ORDER_BY(t.RetrievalID.DESC(), t.Position.ASC()).QueryContext(ctx, db, &rows)
	if err != nil {
		return nil, err
	}
	var states []model.ResourceStates
	if err := state.SELECT(state.AllColumns).WHERE(state.LmsMaterialID.EQ(sqlite.String(material))).QueryContext(ctx, db, &states); err != nil {
		return nil, err
	}
	byID := map[string]model.ResourceStates{}
	for _, row := range states {
		byID[row.LmsResourceID] = row
	}
	result := []domain.Resource{}
	for _, row := range rows {
		resource := domain.Resource{ID: row.LmsResourceID, Name: row.Name, Type: row.Type, SourceKind: row.SourceKind, URL: row.URL, Availability: "current"}
		if archived || row.RetrievalID != latest {
			resource.Availability = "archived"
		}
		saved := byID[row.LmsResourceID]
		if saved.FileID != nil {
			resource.SavedFile = &domain.SavedFile{ID: *saved.FileID, OriginalFilename: *saved.OriginalFilename, SHA256: *saved.Sha256, Size: *saved.FileSize}
		}
		if saved.LastAttemptAt != nil {
			resource.Acquisition = &domain.Acquisition{LastSucceededAt: millisTime(saved.LastSucceededAt), LastAttempt: domain.Attempt{At: *millisTime(saved.LastAttemptAt), Status: *saved.LastAttemptStatus}}
			if saved.LastAttemptError != nil {
				resource.Acquisition.LastAttempt.Error = *saved.LastAttemptError
			}
		}
		result = append(result, resource)
	}
	return result, nil
}
