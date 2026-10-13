package chromedp

import "testing"

func TestCourseSchedule(t *testing.T) {
	for _, tc := range []struct {
		category, label, kind string
		weekday, period       int64
	}{
		{"月曜日", "2限", "scheduled", 1, 2},
		{"火曜日", "1限", "scheduled", 2, 1},
		{"水曜日", "3限", "scheduled", 3, 3},
		{"木曜日", "4限", "scheduled", 4, 4},
		{"金曜日", "6限", "scheduled", 5, 6},
		{"土曜日", "7限", "scheduled", 6, 7},
		{"日曜日", "12限", "scheduled", 7, 12},
		{"その他", "", "other", 0, 0},
		{"その他", "2限", "other", 0, 0},
		{"未知の区分", "2限", "unknown", 0, 0},
		{"月曜日", "", "unknown", 0, 0},
		{"月曜日", "0限", "unknown", 0, 0},
		{"月曜日", "1～2限", "unknown", 0, 0},
		{"月曜日", "9223372036854775808限", "unknown", 0, 0},
	} {
		t.Run(tc.category+"/"+tc.label, func(t *testing.T) {
			kind, weekday, period, err := parseCourseSchedule(tc.category, tc.label)
			if kind != tc.kind || (err != nil) != (tc.kind == "unknown") {
				t.Fatalf("kind = %s, error = %v", kind, err)
			}
			if tc.kind == "scheduled" {
				if weekday == nil || period == nil || *weekday != tc.weekday || *period != tc.period {
					t.Fatalf("incorrect schedule: weekday=%v period=%v", weekday, period)
				}
			} else if weekday != nil || period != nil {
				t.Fatal("other or unknown course retained a schedule")
			}
		})
	}
}

func TestCalendarDates(t *testing.T) {
	for input, want := range map[string]string{"2026/10/05": "2026-10-05", "2026-10-05": "2026-10-05", "－": "", "": ""} {
		got, err := parseCalendarDate(input)
		if err != nil || got != want {
			t.Fatalf("%s: %s %v", input, got, err)
		}
	}
	for _, input := range []string{"2026/02/30", "2026/10/05 12:00", "0000/01/01"} {
		if _, err := parseCalendarDate(input); err == nil {
			t.Fatal("accepted invalid calendar date", input)
		}
	}
}

func TestDatesUseJSTAndExplicitDeadlineStates(t *testing.T) {
	for input, want := range map[string]string{"2026/10/05": "2026-10-04T15:00:00Z", "2026/10/31 23:59": "2026-10-31T14:59:00Z", "公開終了": "unavailable", "Unavailable": "unavailable", "－": "no-deadline"} {
		got, err := parseDeadline(input)
		if err != nil || got != want {
			t.Fatalf("%s: %s %v", input, got, err)
		}
	}
}

func TestMaterialTypeLabels(t *testing.T) {
	for label, want := range map[string]string{
		"Materials": "material", "資料": "material",
		"Report": "report", "レポート": "report",
		"Test": "test", "テスト": "test",
		"Questionnaire": "questionnaire", "アンケート": "questionnaire",
		"e-Learning": "e-learning", "e-learning": "e-learning",
		"Board": "board", "掲示板": "board",
		"Feedback": "feedback", "フィードバック": "feedback",
	} {
		got, err := parseType(label)
		if err != nil || got != want {
			t.Fatalf("%q: got %q, want %q: %v", label, got, want, err)
		}
	}
	if _, err := parseType("unknown"); err == nil {
		t.Fatal("accepted unknown material type")
	}
}

func TestEndOfDayUsesNextMidnightInJST(t *testing.T) {
	for input, want := range map[string]string{
		"2026/10/11 24:00":    "2026-10-11T15:00:00Z",
		"2026/10/31 24:00:00": "2026-10-31T15:00:00Z",
		"2026-12-31 24:00":    "2026-12-31T15:00:00Z",
		"2028/02/29 24:00":    "2028-02-29T15:00:00Z",
	} {
		got, err := parseDeadline(input)
		if err != nil || got != want {
			t.Fatalf("%s: %s %v", input, got, err)
		}
	}
	for _, input := range []string{"2026/02/30 24:00", "2026/10/11 24:01", "2026/10/11 24:00:01", "2026/10/11 25:00"} {
		if _, err := parseDate(input); err == nil {
			t.Fatal("accepted invalid date", input)
		}
	}
}
