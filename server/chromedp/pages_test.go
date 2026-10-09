package chromedp

import "testing"

func TestDatesUseJSTAndExplicitDeadlineStates(t *testing.T) {
	for input, want := range map[string]string{"2026/10/05": "2026-10-04T15:00:00Z", "2026/10/31 23:59": "2026-10-31T14:59:00Z", "公開終了": "unavailable", "Unavailable": "unavailable", "－": "no-deadline"} {
		got, err := parseDeadline(input)
		if err != nil || got != want {
			t.Fatalf("%s: %s %v", input, got, err)
		}
	}
	if _, err := parseDate("2026/02/30"); err == nil {
		t.Fatal("accepted invalid date")
	}
	if _, err := parseType("unknown"); err == nil {
		t.Fatal("accepted unknown type")
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
