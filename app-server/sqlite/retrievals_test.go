package sqlite

import (
	"context"
	"fmt"
	"math"
	"path/filepath"
	"reflect"
	"slices"
	"testing"
	"time"

	"github.com/futsuuu/ku-potato/app-server/domain"
	"github.com/futsuuu/ku-potato/app-server/sqlite/gen/model"
	"github.com/futsuuu/ku-potato/app-server/sqlite/gen/table"
	"github.com/go-jet/jet/v2/sqlite"
	"github.com/google/uuid"
)

// Fixed database fixtures, not an import contract. Each kind gets its own ID.
func insertRetrievalFixtures(
	t *testing.T,
	s *Store,
	seed int64,
	clock retrievalClock,
	snapshot domain.Snapshot,
) {
	t.Helper()
	ctx := context.Background()
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback() }()
	id := func(kind int64) string {
		return fmt.Sprintf("00000000-0000-4000-8000-%012d", seed*10+kind)
	}
	if snapshot.Courses != nil {
		if _, err := insertCourses(
			ctx,
			tx,
			id(1),
			clock,
			snapshot.AcademicYear,
			snapshot.Courses,
		); err != nil {
			t.Fatal(err)
		}
	}
	if snapshot.Materials != nil {
		if _, err := insertMaterials(ctx, tx, id(2), clock, *snapshot.Materials); err != nil {
			t.Fatal(err)
		}
	}
	if snapshot.Resources != nil {
		if _, err := insertResources(
			ctx,
			tx,
			id(3),
			clock,
			snapshot.MaterialID,
			snapshot.Resources,
		); err != nil {
			t.Fatal(err)
		}
	}
	if snapshot.Report != nil {
		if _, err := insertReport(
			ctx,
			tx,
			id(4),
			clock,
			snapshot.MaterialID,
			*snapshot.Report,
		); err != nil {
			t.Fatal(err)
		}
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
}

func TestArchiveSelectionUsesClockAndIDInsteadOfInsertionOrder(t *testing.T) {
	ctx := context.Background()
	first := archiveSnapshot()
	first.Report = &domain.ReportDetail{Status: "unsubmitted"}
	second := archiveSnapshot()
	second.Courses[0].Name = "new course"
	second.Materials.Folders[0].Materials[0].Name = "last accessible material"
	second.Resources = second.Resources[:1]
	second.Resources[0].Name = "new resource"
	second.Report = &domain.ReportDetail{Status: "submitted"}
	private := archiveSnapshot()
	private.Materials.Folders[0].Materials[0].Name = "private placeholder"
	private.Materials.Folders[0].Materials[0].ResourceAvailability = "unavailable"
	private.Courses, private.Resources = nil, nil
	snapshots := []domain.Snapshot{
		first, second, private,
		{MaterialID: "SRY1", Resources: []domain.RetrievedResource{}},
		{AcademicYear: 2026, Courses: []domain.Course{}},
		{AcademicYear: 2027, Courses: []domain.Course{{ID: "KOG2", Name: "next year"}}},
	}
	clocks := []struct {
		millis, counter, seed int64
	}{
		{1000, 0, 100}, {1000, 0, 101}, // ID breaks a clock tie
		{1000, 1, 99}, // counter takes precedence over ID
		{1001, 0, 98}, {1001, 1, 97}, {1002, 0, 96},
	}
	stores := []*Store{}
	for _, reversed := range []bool{false, true} {
		s, err := Open(filepath.Join(t.TempDir(), "archive.sqlite"))
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _ = s.Close() })
		stores = append(stores, s)
		order := []int{0, 1, 2, 3, 4, 5}
		if reversed {
			slices.Reverse(order)
		}
		for _, i := range order {
			clock := clocks[i]
			insertRetrievalFixtures(t, s, clock.seed, retrievalClock{
				FetchedAt: clock.millis, ClockMillis: clock.millis, ClockCounter: clock.counter,
			}, snapshots[i])
		}
		courses, err := s.Courses(ctx)
		if err != nil || len(courses) != 2 || courses[0].ID != "KOG2" || !courses[1].Archived ||
			courses[1].Name != "new course" {
			t.Fatal(courses, err)
		}
		detail, err := s.Detail(ctx, "SRY1")
		if err != nil || !detail.Material.Archived ||
			detail.Material.Name != "last accessible material" ||
			len(detail.Resources) != 2 ||
			detail.Resources[0].Name != "new resource" {
			t.Fatal(detail, err)
		}
		for _, resource := range detail.Resources {
			if resource.Availability != "archived" || resource.SavedFile != nil {
				t.Fatal(resource)
			}
		}
		if detail.Material.FetchedAt == nil || detail.Material.FetchedAt.UnixMilli() != 1001 {
			t.Fatal("wrong content retrieval time", detail.Material)
		}
		report, err := s.ReportDetail(ctx, "SRY1")
		if err != nil || report.Status != "submitted" || report.FetchedAt == nil ||
			report.FetchedAt.UnixMilli() != 1000 {
			t.Fatal(report, err)
		}
	}
	detailA, _ := stores[0].Detail(ctx, "SRY1")
	detailB, _ := stores[1].Detail(ctx, "SRY1")
	if !reflect.DeepEqual(detailA, detailB) {
		t.Fatal("arrival order changed the view", detailA, detailB)
	}
}

func TestFindCourseUsesRetrievalClockAndID(t *testing.T) {
	ctx := context.Background()
	for _, test := range []struct {
		name             string
		older, newer     retrievalClock
		oldSeed, newSeed int64
	}{
		{"millis", retrievalClock{1000, 1000, 99}, retrievalClock{999, 1001, 0}, 100, 99},
		{"counter", retrievalClock{1000, 1000, 0}, retrievalClock{999, 1000, 1}, 100, 99},
		{"id", retrievalClock{1000, 1000, 0}, retrievalClock{999, 1000, 0}, 100, 101},
	} {
		t.Run(test.name, func(t *testing.T) {
			for _, reversed := range []bool{false, true} {
				s := newStore(t)
				order := []int{0, 1}
				if reversed {
					slices.Reverse(order)
				}
				for _, i := range order {
					snapshot := archiveSnapshot()
					snapshot.Materials.CourseID = fmt.Sprintf("KOG%d", i+1)
					snapshot.Courses, snapshot.Resources = nil, nil
					clock, seed := test.older, test.oldSeed
					if i == 1 {
						clock, seed = test.newer, test.newSeed
					}
					insertRetrievalFixtures(t, s, seed, clock, snapshot)
				}
				if course, err := s.FindCourse(ctx, "SRY1"); err != nil || course != "KOG2" {
					t.Fatal(course, err)
				}
			}
		})
	}
}

func TestRetrievalClockAdvancesWithoutPackingItsComponents(t *testing.T) {
	state := model.ArchiveState{
		ClockMillis:  1000,
		ClockCounter: 5,
	}
	for _, test := range []struct{ now, millis, counter int64 }{
		{1001, 1001, 0}, {1000, 1000, 6}, {999, 1000, 6},
	} {
		entry, err := advanceRetrievalClock(state, test.now)
		if err != nil || entry.ClockMillis != test.millis || entry.ClockCounter != test.counter ||
			entry.FetchedAt != test.now {
			t.Fatal(entry, err)
		}
	}
	if _, err := advanceRetrievalClock(state, -1); err == nil {
		t.Fatal("accepted negative timestamp")
	}
	state.ClockCounter = math.MaxInt64
	if _, err := advanceRetrievalClock(state, 1000); err == nil {
		t.Fatal("clock counter overflowed")
	}
}

type storedRetrieval struct {
	ID            string
	FetchedAt     int64
	ClockMillis   int64
	ClockCounter  int64
	AcademicYear  int64
	LmsCourseID   string
	LmsMaterialID string
}

func storedRetrievals(t *testing.T, s *Store) map[string][]storedRetrieval {
	t.Helper()
	c := table.CourseRetrievals.AS("stored_retrieval")
	m := table.CourseMaterialRetrievals.AS("stored_retrieval")
	r := table.MaterialResourceRetrievals.AS("stored_retrieval")
	d := table.ReportDetailRetrievals.AS("stored_retrieval")
	queries := map[string]sqlite.SelectStatement{
		"courses":   c.SELECT(c.AllColumns).ORDER_BY(c.ClockCounter.ASC()),
		"materials": m.SELECT(m.AllColumns).ORDER_BY(m.ClockCounter.ASC()),
		"resources": r.SELECT(r.AllColumns).ORDER_BY(r.ClockCounter.ASC()),
		"report":    d.SELECT(d.AllColumns).ORDER_BY(d.ClockCounter.ASC()),
	}
	result := map[string][]storedRetrieval{}
	for kind, query := range queries {
		var rows []storedRetrieval
		if err := query.QueryContext(context.Background(), s.db, &rows); err != nil {
			t.Fatal(err)
		}
		result[kind] = rows
	}
	return result
}

func TestRetrievalMetadataAndClockSurviveRestartAndRollbackTogether(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "archive.sqlite")
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = s.Close() })
	future := time.Now().Add(24 * time.Hour).UnixMilli()
	state := table.ArchiveState
	if _, err := state.UPDATE(state.ClockMillis, state.ClockCounter).SET(future, 10).
		WHERE(state.Singleton.EQ(sqlite.Int(1))).ExecContext(ctx, s.db); err != nil {
		t.Fatal(err)
	}
	snapshot := archiveSnapshot()
	snapshot.Report = &domain.ReportDetail{}
	first, err := s.Append(ctx, snapshot)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	s, err = Open(path)
	if err != nil {
		t.Fatal(err)
	}
	second, err := s.Append(ctx, snapshot)
	if err != nil {
		t.Fatal(err)
	}
	entries := storedRetrievals(t, s)
	wantIDs := map[string][]string{
		"courses":   {first.Courses, second.Courses},
		"materials": {first.Materials, second.Materials},
		"resources": {first.Resources, second.Resources},
		"report":    {first.Report, second.Report},
	}
	identities := map[string]bool{}
	timestamps := map[int]int64{}
	for kind, rows := range entries {
		if len(rows) != 2 {
			t.Fatalf("%s: %+v", kind, rows)
		}
		for i, row := range rows {
			if row.ID != wantIDs[kind][i] || identities[row.ID] {
				t.Fatal("retrieval identity reused", kind, row)
			}
			identities[row.ID] = true
			if id, err := uuid.Parse(row.ID); err != nil || id == uuid.Nil {
				t.Fatal("invalid global identity", row.ID, err)
			}
			if row.FetchedAt <= 0 || row.FetchedAt >= future || row.ClockMillis != future ||
				row.ClockCounter != int64(11+i) {
				t.Fatal(kind, row)
			}
			if previous, ok := timestamps[i]; ok && previous != row.FetchedAt {
				t.Fatal("one Append has inconsistent timestamps", kind, row)
			}
			timestamps[i] = row.FetchedAt
			switch kind {
			case "courses":
				if row.AcademicYear != int64(snapshot.AcademicYear) {
					t.Fatal(row)
				}
			case "materials":
				if row.LmsCourseID != snapshot.Materials.CourseID {
					t.Fatal(row)
				}
			default:
				if row.LmsMaterialID != snapshot.MaterialID {
					t.Fatal(row)
				}
			}
		}
	}
	broken := snapshot
	broken.Resources = append(slices.Clone(snapshot.Resources), snapshot.Resources[0])
	if _, err := s.Append(ctx, broken); err == nil {
		t.Fatal("accepted duplicate resources")
	}
	if after := storedRetrievals(t, s); !reflect.DeepEqual(entries, after) {
		t.Fatal("failed snapshot retained metadata", after)
	}
	current, err := loadArchiveState(ctx, s.db)
	if err != nil || current.ClockMillis != future || current.ClockCounter != 12 {
		t.Fatal("failed snapshot advanced the clock", current, err)
	}
}

func TestStandaloneRetrievalsHaveTheirOwnMetadata(t *testing.T) {
	snapshot := archiveSnapshot()
	for _, test := range []struct {
		kind     string
		snapshot domain.Snapshot
	}{
		{"courses", domain.Snapshot{AcademicYear: snapshot.AcademicYear, Courses: snapshot.Courses}},
		{"materials", domain.Snapshot{Materials: snapshot.Materials}},
		{"resources", domain.Snapshot{MaterialID: snapshot.MaterialID, Resources: snapshot.Resources}},
		{"report", domain.Snapshot{MaterialID: snapshot.MaterialID, Report: &domain.ReportDetail{}}},
	} {
		t.Run(test.kind, func(t *testing.T) {
			s := newStore(t)
			if _, err := s.Append(context.Background(), test.snapshot); err != nil {
				t.Fatal(err)
			}
			for kind, rows := range storedRetrievals(t, s) {
				if kind != test.kind {
					if len(rows) != 0 {
						t.Fatal("unrelated retrieval created", kind, rows)
					}
					continue
				}
				if len(rows) != 1 || rows[0].FetchedAt <= 0 ||
					rows[0].ClockMillis < rows[0].FetchedAt {
					t.Fatal(kind, rows)
				}
			}
		})
	}
}
