package sqlite

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"github.com/futsuuu/ku-potato/app-server/domain"
	"github.com/futsuuu/ku-potato/app-server/sqlite/gen/model"
	"github.com/futsuuu/ku-potato/app-server/sqlite/gen/table"
	"github.com/go-jet/jet/v2/qrm"
	"github.com/go-jet/jet/v2/sqlite"
)

// Keep latest-retrieval lookups and their rows in the same database snapshot.
func readStore[T any](
	ctx context.Context,
	s *Store,
	load func(qrm.DB) (T, error),
) (zero T, err error) {
	tx, err := s.db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return zero, err
	}
	defer func() { _ = tx.Rollback() }()
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
	_, err := latestID(ctx, db, r.SELECT(r.ID.AS("id")).ORDER_BY(r.ID.DESC()).LIMIT(1))
	if err != nil {
		return nil, err
	}
	t, history := table.Courses, table.Courses.AS("history")
	hr := r.AS("history_retrieval")
	latestPerYear := sqlite.SELECT(hr.AcademicYear, sqlite.MAX(hr.ID)).
		FROM(hr).
		GROUP_BY(hr.AcademicYear)
	latestPerCourse := sqlite.SELECT(
		hr.AcademicYear, history.LmsCourseID, sqlite.MAX(history.RetrievalID),
	).
		FROM(history.INNER_JOIN(hr, history.RetrievalID.EQ(hr.ID))).
		GROUP_BY(hr.AcademicYear, history.LmsCourseID)
	var rows []struct {
		model.Courses
		model.CourseRetrievals
	}
	err = t.SELECT(t.AllColumns, r.AllColumns).
		FROM(t.INNER_JOIN(r, t.RetrievalID.EQ(r.ID))).
		WHERE(sqlite.OR(
			sqlite.ROW(r.AcademicYear, r.ID).IN(latestPerYear),
			sqlite.AND(
				t.LmsCourseID.IS_NOT_NULL(),
				sqlite.ROW(r.AcademicYear, t.LmsCourseID, t.RetrievalID).IN(latestPerCourse),
			),
		)).
		ORDER_BY(t.RetrievalID.DESC(), t.Position.ASC()).
		QueryContext(ctx, db, &rows)
	if err != nil {
		return nil, err
	}
	result := []domain.Course{}
	var retrievals []model.CourseRetrievals
	if err := r.SELECT(r.AllColumns).
		WHERE(sqlite.ROW(r.AcademicYear, r.ID).IN(latestPerYear)).
		QueryContext(ctx, db, &retrievals); err != nil {
		return nil, err
	}
	latestYear := map[int64]int64{}
	for _, retrieval := range retrievals {
		if _, exists := latestYear[retrieval.AcademicYear]; !exists {
			latestYear[retrieval.AcademicYear] = *retrieval.ID
		}
	}
	for _, row := range rows {
		course := domain.Course{
			Name:         row.Name,
			Availability: row.Availability,
			Archived:     row.RetrievalID != latestYear[row.AcademicYear],
			AcademicYear: int(row.AcademicYear),
			Type:         row.Type,
			Weekday:      row.Weekday,
			Period:       row.Period,
		}
		if row.LmsCourseID != nil {
			course.ID = *row.LmsCourseID
		}
		result = append(result, course)
	}
	return result, nil
}

func (s *Store) Materials(ctx context.Context, id string) (domain.CourseMaterials, error) {
	return readStore(
		ctx,
		s,
		func(db qrm.DB) (domain.CourseMaterials, error) { return materials(ctx, db, id) },
	)
}

type materialRow struct {
	model.CourseMaterials
	model.CourseMaterialFolders
	model.CourseMaterialRetrievals
}

func materialHistory(
	ctx context.Context,
	db qrm.DB,
	course string,
	accessible bool,
) ([]materialRow, error) {
	t, r, f := table.CourseMaterials, table.CourseMaterialRetrievals, table.CourseMaterialFolders
	history, hr := t.AS("history"), r.AS("history_retrieval")
	condition := hr.LmsCourseID.EQ(sqlite.String(course))
	if accessible {
		condition = condition.AND(history.ResourceAvailability.NOT_EQ(sqlite.String("unavailable"))).
			AND(history.PublicationDeadlineKind.NOT_EQ(sqlite.String("closed")))
	}
	latest := sqlite.SELECT(history.LmsMaterialID, sqlite.MAX(history.RetrievalID)).
		FROM(history.INNER_JOIN(hr, history.RetrievalID.EQ(hr.ID))).
		WHERE(condition).GROUP_BY(history.LmsMaterialID)
	var rows []materialRow
	err := t.SELECT(t.AllColumns, f.AllColumns, r.AllColumns).
		FROM(t.INNER_JOIN(r, t.RetrievalID.EQ(r.ID)).INNER_JOIN(f, t.RetrievalID.EQ(f.RetrievalID).AND(t.FolderPosition.EQ(f.Position)))).
		WHERE(r.LmsCourseID.EQ(sqlite.String(course)).AND(sqlite.ROW(t.LmsMaterialID, t.RetrievalID).IN(latest))).
		ORDER_BY(t.RetrievalID.DESC(), t.Position.ASC()).QueryContext(ctx, db, &rows)
	return rows, err
}

// Listing retrievals do not mean a material's contents have been fetched.
func materialContentTimes(
	ctx context.Context,
	db qrm.DB,
	course string,
) (map[string]*time.Time, error) {
	t, cr := table.CourseMaterials, table.CourseMaterialRetrievals
	ids := t.SELECT(t.LmsMaterialID).FROM(t.INNER_JOIN(cr, t.RetrievalID.EQ(cr.ID))).
		WHERE(cr.LmsCourseID.EQ(sqlite.String(course)))
	r := table.MaterialResourceRetrievals
	var rows []struct {
		MaterialID string
		FetchedAt  int64
	}
	err := r.SELECT(r.LmsMaterialID.AS("material_id"), r.FetchedAt.AS("fetched_at")).
		WHERE(sqlite.ROW(r.LmsMaterialID, r.ID).IN(r.SELECT(r.LmsMaterialID, sqlite.MAX(r.ID)).
			WHERE(r.LmsMaterialID.IN(ids)).GROUP_BY(r.LmsMaterialID))).QueryContext(ctx, db, &rows)
	if err != nil {
		return nil, err
	}
	result := map[string]*time.Time{}
	for _, row := range rows {
		result[row.MaterialID] = millisTime(&row.FetchedAt)
	}
	return result, nil
}

func materials(ctx context.Context, db qrm.DB, id string) (domain.CourseMaterials, error) {
	result := domain.CourseMaterials{CourseID: id, Folders: []domain.Folder{}}
	r := table.CourseMaterialRetrievals
	latest, err := latestID(
		ctx,
		db,
		r.SELECT(r.ID.AS("id")).
			WHERE(r.LmsCourseID.EQ(sqlite.String(id))).
			ORDER_BY(r.ID.DESC()).
			LIMIT(1),
	)
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
	if err := f.SELECT(f.AllColumns).
		WHERE(f.RetrievalID.EQ(sqlite.Int(latest))).
		ORDER_BY(f.Position.ASC()).
		QueryContext(ctx, db, &folders); err != nil {
		return result, err
	}
	currentFolders := map[int64]int{}
	for _, folder := range folders {
		currentFolders[folder.Position] = len(result.Folders)
		result.Folders = append(
			result.Folders,
			domain.Folder{
				Name:            folder.Name,
				ClassDate:       text(folder.ClassDate),
				DescriptionHTML: folder.DescriptionHTML,
				Materials:       []domain.Material{},
			},
		)
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
	contentTimes, err := materialContentTimes(ctx, db, id)
	if err != nil {
		return result, err
	}
	for _, row := range rows {
		retrieval := row.CourseMaterials
		content := retrieval
		private := retrieval.ResourceAvailability == "unavailable" ||
			retrieval.PublicationDeadlineKind == "closed"
		if private {
			// Preserve the last accessible metadata, while exposing the latest public state.
			if prior, ok := byID[retrieval.LmsMaterialID]; ok {
				content = prior.CourseMaterials
			}
		}
		var fetchedAt *time.Time
		if content.Type == "material" {
			fetchedAt = contentTimes[content.LmsMaterialID]
		}
		material := domain.Material{
			ID:   content.LmsMaterialID,
			Name: content.Name,
			Type: content.Type,
			PublicationDeadline: displayedDeadline(
				content.PublicationDeadlineKind,
				content.PublicationDeadlineAt,
			),
			ResourceAvailability:    retrieval.ResourceAvailability,
			PublicationDeadlineKind: content.PublicationDeadlineKind,
			PublicationDeadlineAt:   millisTime(content.PublicationDeadlineAt),
			Status:                  retrieval.Status,
			MaterialLinkAvailable:   retrieval.MaterialLinkAvailable != 0,
			FetchedAt:               fetchedAt,
			Archived:                courseArchived || retrieval.RetrievalID != latest || private,
		}
		index, current := currentFolders[retrieval.FolderPosition]
		if retrieval.RetrievalID != latest || !current {
			index = -1
			for i, folder := range result.Folders {
				if folder.Name == row.CourseMaterialFolders.Name &&
					folder.ClassDate == text(row.ClassDate) {
					index = i
					break
				}
			}
			if index < 0 {
				index = len(result.Folders)
				result.Folders = append(
					result.Folders,
					domain.Folder{
						Name:            row.CourseMaterialFolders.Name,
						ClassDate:       text(row.ClassDate),
						DescriptionHTML: row.DescriptionHTML,
						Materials:       []domain.Material{},
					},
				)
			}
		}
		result.Folders[index].Materials = append(result.Folders[index].Materials, material)
	}
	return result, nil
}

func (s *Store) FindCourse(ctx context.Context, material string) (string, error) {
	return readStore(
		ctx,
		s,
		func(db qrm.DB) (string, error) { return findCourse(ctx, db, material) },
	)
}

func findCourse(ctx context.Context, db qrm.DB, material string) (string, error) {
	t, r := table.CourseMaterials, table.CourseMaterialRetrievals
	var row model.CourseMaterialRetrievals
	err := r.SELECT(r.AllColumns).FROM(r.INNER_JOIN(t, r.ID.EQ(t.RetrievalID))).
		WHERE(t.LmsMaterialID.EQ(sqlite.String(material))).
		ORDER_BY(r.ID.DESC()).LIMIT(1).QueryContext(ctx, db, &row)
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
		result.Resources, err = resources(
			ctx,
			db,
			id,
			result.Material.Archived || result.Material.ResourceAvailability == "unavailable",
		)
		if errors.Is(err, domain.ErrMissing) && result.Material.Type != "material" {
			result.Resources, err = []domain.Resource{}, nil
		}
		if err != nil {
			return result, err
		}
		if result.Material.Type == "report" {
			detail, e := reportDetail(ctx, db, id)
			if e != nil && !errors.Is(e, domain.ErrMissing) {
				return result, e
			}
			if e == nil {
				result.Report = &detail
			}
		}
		return result, err
	})
}

func resources(
	ctx context.Context,
	db qrm.DB,
	material string,
	archived bool,
) ([]domain.Resource, error) {
	r := table.MaterialResourceRetrievals
	latest, err := latestID(
		ctx,
		db,
		r.SELECT(r.ID.AS("id")).
			WHERE(r.LmsMaterialID.EQ(sqlite.String(material))).
			ORDER_BY(r.ID.DESC()).
			LIMIT(1),
	)
	if errors.Is(err, domain.ErrMissing) && archived {
		return []domain.Resource{}, nil
	}
	if err != nil {
		return nil, err
	}
	t, state := table.MaterialResources, table.SavedResources
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
	var savedResources []model.SavedResources
	if err := state.SELECT(state.AllColumns).
		WHERE(state.LmsMaterialID.EQ(sqlite.String(material))).
		QueryContext(ctx, db, &savedResources); err != nil {
		return nil, err
	}
	byID := map[string]model.SavedResources{}
	for _, row := range savedResources {
		byID[row.LmsResourceID] = row
	}
	result := []domain.Resource{}
	for _, row := range rows {
		resource := domain.Resource{
			ID:            row.LmsResourceID,
			Name:          row.Name,
			Type:          row.Type,
			URL:           row.URL,
			Availability:  "current",
			Status:        row.Status,
			RegisteredOn:  row.RegisteredOn,
			FirstViewedOn: row.FirstViewedOn,
			Description:   row.Description,
		}
		if archived || row.RetrievalID != latest {
			resource.Availability = "archived"
		}
		if saved, ok := byID[row.LmsResourceID]; ok {
			file := savedFile(saved)
			resource.SavedFile = &file
		}
		result = append(result, resource)
	}
	return result, nil
}
