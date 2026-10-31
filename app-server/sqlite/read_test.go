package sqlite

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/futsuuu/ku-potato/app-server/domain"
)

func ptr[T any](value T) *T { return &value }

func TestCourseHistoryIsScopedByYearAndRetainsPlacements(t *testing.T) {
	s := newStore(t)
	ctx := context.Background()
	old := domain.Snapshot{AcademicYear: 2025, Courses: []domain.Course{
		{ID: "KOG1", Name: "first", Type: "scheduled", Weekday: ptr(int64(1)), Period: ptr(int64(2))},
		{ID: "KOG1", Name: "second", Type: "scheduled", Weekday: ptr(int64(2)), Period: ptr(int64(3))},
		{Name: "same", Type: "other"}, {Name: "same", Type: "other"},
	}}
	if _, err := s.Append(ctx, old); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Append(ctx, domain.Snapshot{AcademicYear: 2026, Courses: []domain.Course{}}); err != nil {
		t.Fatal(err)
	}
	courses, err := s.Courses(ctx)
	if err != nil || len(courses) != 4 {
		t.Fatal(courses, err)
	}
	for _, c := range courses {
		if c.Archived || c.AcademicYear != 2025 {
			t.Fatal(c)
		}
	}
	for i, want := range []struct{ id, name string }{
		{"KOG1", "first"}, {"KOG1", "second"}, {"", "same"}, {"", "same"},
	} {
		if courses[i].ID != want.id || courses[i].Name != want.name {
			t.Fatalf("course %d = %#v, want id=%q name=%q", i, courses[i], want.id, want.name)
		}
	}
	if courses[1].Weekday == nil || *courses[1].Weekday != 2 || courses[2].Weekday != nil || courses[2].Period != nil {
		t.Fatal(courses)
	}
	if _, err := s.Append(ctx, domain.Snapshot{AcademicYear: 2025, Courses: []domain.Course{}}); err != nil {
		t.Fatal(err)
	}
	courses, err = s.Courses(ctx)
	if err != nil || len(courses) != 2 || !courses[0].Archived || !courses[1].Archived {
		t.Fatal(courses, err)
	}
}

func TestMetadataAndReportDetailsRoundTrip(t *testing.T) {
	s := newStore(t)
	ctx := context.Background()
	snapshot := archiveSnapshot()
	snapshot.Materials.Folders[0].ClassDate = "2026-10-05"
	snapshot.Materials.Folders[0].DescriptionHTML = ptr("")
	snapshot.Materials.Folders[0].Materials = append(snapshot.Materials.Folders[0].Materials, domain.Material{ID: "REP1", Type: "report", Status: "unsubmitted", PublicationDeadline: "no-deadline"})
	snapshot.Resources[0].Status, snapshot.Resources[0].RegisteredOn, snapshot.Resources[0].FirstViewedOn, snapshot.Resources[0].Description = "viewed", ptr("2026-10-01"), ptr("2026-10-05"), ptr("line 1\nline 2")
	if _, err := s.Append(ctx, snapshot); err != nil {
		t.Fatal(err)
	}
	detail, err := s.Detail(ctx, "SRY1")
	if err != nil || detail.Resources[0].Description == nil || *detail.Resources[0].Description != "line 1\nline 2" || detail.Resources[0].Status != "viewed" || *detail.Resources[0].RegisteredOn != "2026-10-01" || *detail.Resources[0].FirstViewedOn != "2026-10-05" {
		t.Fatal(detail, err)
	}
	listing, err := s.Materials(ctx, "KOG1")
	if err != nil || listing.Folders[0].ClassDate != "2026-10-05" || listing.Folders[0].DescriptionHTML == nil || *listing.Folders[0].DescriptionHTML != "" {
		t.Fatal(listing, err)
	}
	if _, err := s.ReportDetail(ctx, "REP1"); !errors.Is(err, domain.ErrMissing) {
		t.Fatal(err)
	}
	report, err := s.Detail(ctx, "REP1")
	if err != nil || report.Report != nil {
		t.Fatal(report, err)
	}
	start, end := time.UnixMilli(10).UTC(), time.UnixMilli(20).UTC()
	snapshot = domain.Snapshot{MaterialID: "REP1", Report: &domain.ReportDetail{
		PromptHTML: ptr(""), Status: "submitted", SubmissionPeriodKind: "at", SubmissionStartsAt: &start, SubmissionDueAt: &end,
		CorrectionMode: "limited", CorrectionLimit: ptr(int64(0)), TextAnswerAllowed: ptr(false), FileAnswerAllowed: ptr(true), MaxTotalFileBytes: ptr(int64(5 * 1024 * 1024)),
	}}
	if _, err := s.Append(ctx, snapshot); err != nil {
		t.Fatal(err)
	}
	report, err = s.Detail(ctx, "REP1")
	if err != nil || report.Report == nil {
		t.Fatal(report, err)
	}
	r := report.Report
	if r.PromptHTML == nil || *r.PromptHTML != "" || r.Status != "submitted" || !r.SubmissionStartsAt.Equal(start) || !r.SubmissionDueAt.Equal(end) || *r.CorrectionLimit != 0 || *r.TextAnswerAllowed || !*r.FileAnswerAllowed || *r.MaxTotalFileBytes != 5*1024*1024 || r.FetchedAt == nil {
		t.Fatal(r)
	}
	private := domain.Snapshot{Materials: &domain.CourseMaterials{CourseID: "KOG1", Folders: []domain.Folder{{Materials: []domain.Material{{ID: "REP1", Type: "report", PublicationDeadline: "unavailable"}}}}}}
	if _, err := s.Append(ctx, private); err != nil {
		t.Fatal(err)
	}
	report, err = s.Detail(ctx, "REP1")
	if err != nil || !report.Material.Archived || report.Report == nil || report.Report.Status != "submitted" || report.Report.PromptHTML == nil {
		t.Fatal(report, err)
	}
	if _, err := s.Append(ctx, domain.Snapshot{MaterialID: "REP1", Report: &domain.ReportDetail{}}); err != nil {
		t.Fatal(err)
	}
	raw, err := s.ReportDetail(ctx, "REP1")
	if err != nil || raw.PromptHTML != nil || raw.MaxTotalFileBytes != nil || raw.Status != "unknown" || raw.CorrectionMode != "unknown" {
		t.Fatal(raw, err)
	}
	var count int
	if err := s.db.QueryRow("SELECT count(*) FROM report_detail_retrievals WHERE lms_material_id='REP1'").Scan(&count); err != nil || count != 2 {
		t.Fatal(count, err)
	}
}
