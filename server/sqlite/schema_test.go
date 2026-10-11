package sqlite

import (
	"context"
	"testing"
)

func TestSchemaRejectsInvalidSchedulesAndYears(t *testing.T) {
	s := newStore(t)
	for _, year := range []any{nil, 0, 10000} {
		if _, err := s.db.Exec("INSERT INTO course_retrievals(fetched_at, academic_year) VALUES (0, ?)", year); err == nil {
			t.Fatalf("accepted year %v", year)
		}
	}
	if _, err := s.db.Exec("INSERT INTO course_retrievals(id, fetched_at, academic_year) VALUES (1, 0, 2026)"); err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct {
		kind            string
		weekday, period any
		valid           bool
	}{
		{"scheduled", 1, 2, true}, {"scheduled", 7, 100, true},
		{"other", nil, nil, true}, {"unknown", nil, nil, true},
		{"scheduled", nil, 2, false}, {"scheduled", 1, nil, false},
		{"scheduled", 0, 2, false}, {"scheduled", 8, 2, false}, {"scheduled", 1, 0, false},
		{"other", 1, nil, false}, {"other", nil, 2, false}, {"unknown", 1, 2, false},
	} {
		t.Run(test.kind, func(t *testing.T) {
			tx, err := s.db.BeginTx(context.Background(), nil)
			if err != nil {
				t.Fatal(err)
			}
			defer tx.Rollback()
			_, err = tx.Exec("INSERT INTO courses(retrieval_id, position, name, availability, type, weekday, period) VALUES (1, 0, '', '', ?, ?, ?)", test.kind, test.weekday, test.period)
			if (err == nil) != test.valid {
				t.Fatalf("%+v: %v", test, err)
			}
		})
	}
}

func TestSchemaEnforcesTypeSpecificStatusesAndDeadlines(t *testing.T) {
	s := newStore(t)
	if _, err := s.Append(context.Background(), archiveSnapshot()); err != nil {
		t.Fatal(err)
	}
	allowed := map[string][]string{
		"material":      {"unviewed", "viewed", "partially-viewed"},
		"report":        {"unviewed", "unsubmitted", "submitted", "resubmission-required", "evaluated"},
		"test":          {"not-started", "in-progress", "completed"},
		"e-learning":    {"not-started", "in-progress", "completed"},
		"questionnaire": {"unanswered", "answered"},
		"board":         {"unposted", "evaluated"}, "feedback": {"unevaluated", "evaluated"}, "unknown": {},
	}
	for kind, statuses := range allowed {
		for _, status := range append(statuses, "unknown") {
			if _, err := s.db.Exec("UPDATE course_materials SET type = ?, status = ?", kind, status); err != nil {
				t.Fatalf("%s/%s: %v", kind, status, err)
			}
		}
	}
	for _, pair := range [][2]string{{"material", "submitted"}, {"test", "answered"}, {"report", "unevaluated"}, {"feedback", "evaluating"}, {"board", "unevaluated"}, {"unknown", "viewed"}} {
		if _, err := s.db.Exec("UPDATE course_materials SET type = ?, status = ?", pair[0], pair[1]); err == nil {
			t.Fatalf("accepted %v", pair)
		}
	}
	for _, query := range []string{
		"UPDATE course_materials SET status = NULL",
		"UPDATE material_resources SET status = NULL",
		"UPDATE material_resources SET status = 'partially-viewed'",
		"UPDATE course_materials SET material_link_available = 2",
		"UPDATE course_materials SET publication_deadline_kind = 'closed'", // existing timestamp must also be cleared
		"UPDATE course_materials SET publication_deadline_at = NULL",       // at needs a timestamp
		"UPDATE resource_states SET last_attempt_status = 'success'",       // missing attempt timestamp
	} {
		if _, err := s.db.Exec(query); err == nil {
			t.Fatalf("accepted: %s", query)
		}
	}
	for _, kind := range []string{"unlisted", "closed", "unknown"} {
		if _, err := s.db.Exec("UPDATE course_materials SET publication_deadline_kind = ?, publication_deadline_at = NULL", kind); err != nil {
			t.Fatal(err)
		}
	}
	var status any
	if err := s.db.QueryRow("SELECT last_attempt_status FROM resource_states LIMIT 1").Scan(&status); err != nil || status != nil {
		t.Fatal(status, err)
	}
}

func TestSchemaEnforcesReportConditions(t *testing.T) {
	s := newStore(t)
	if _, err := s.db.Exec("INSERT INTO report_detail_retrievals(id,lms_material_id,fetched_at) VALUES(1,'REP1',0)"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.db.Exec("INSERT INTO report_details(retrieval_id,status,submission_period_kind,correction_mode) VALUES(1,'unknown','unknown','unknown')"); err != nil {
		t.Fatal(err)
	}
	for _, query := range []string{
		"UPDATE report_details SET status = NULL",
		"UPDATE report_details SET status = 'unevaluated'",
		"UPDATE report_details SET status = 'evaluating'",
		"UPDATE report_details SET submission_period_kind = 'at'",
		"UPDATE report_details SET submission_starts_at = 1",
		"UPDATE report_details SET submission_period_kind = 'at', submission_starts_at = 2, submission_due_at = 1",
		"UPDATE report_details SET correction_mode = 'limited'",
		"UPDATE report_details SET correction_limit = 1",
		"UPDATE report_details SET correction_mode = 'limited', correction_limit = -1",
		"UPDATE report_details SET text_answer_allowed = 2",
		"UPDATE report_details SET file_answer_allowed = 2",
		"UPDATE report_details SET max_total_file_bytes = -1",
	} {
		if _, err := s.db.Exec(query); err == nil {
			t.Fatalf("accepted: %s", query)
		}
	}
	if _, err := s.db.Exec("UPDATE report_details SET submission_period_kind = 'at', submission_due_at = 0, correction_mode = 'limited', correction_limit = 0, text_answer_allowed = 0, file_answer_allowed = 1, max_total_file_bytes = 0"); err != nil {
		t.Fatal(err)
	}
}
