package sqlite

import (
	"log/slog"
	"strings"
	"time"

	"github.com/futsuuu/ku-potato/server/domain"
)

func unknown(id, field string, raw any) {
	slog.Error("unrecognized LMS value", "id", id, "field", field, "value", raw)
}

func enumValue(id, field, value string, allowed ...string) string {
	if value == "" || value == "unknown" {
		return "unknown"
	}
	for _, candidate := range allowed {
		if value == candidate {
			return value
		}
	}
	unknown(id, field, value)
	return "unknown"
}

func materialStatus(id, kind, value string) string {
	return enumValue(id, "status", value, domain.MaterialStatuses(kind)...)
}

func dateOnly(id, field string, value *string) *string {
	if value == nil || *value == "" {
		return nil
	}
	if date, err := time.Parse("2006-01-02", *value); err == nil && date.Year() >= 1 {
		return value
	}
	unknown(id, field, *value)
	return nil
}

func millis(value *time.Time) *int64 {
	if value == nil {
		return nil
	}
	n := value.UnixMilli()
	return &n
}

func boolInt(value bool) int64 {
	if value {
		return 1
	}
	return 0
}

func optionalBool(value *bool) *int64 {
	if value == nil {
		return nil
	}
	n := boolInt(*value)
	return &n
}

func storedBool(value *int64) *bool {
	if value == nil {
		return nil
	}
	b := *value != 0
	return &b
}

func text(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

// PublicationDeadline remains a derived compatibility field for the current UI.
// Only the explicit kind and timestamp are stored in SQLite.
func deadline(material domain.Material) (string, *int64) {
	if material.PublicationDeadlineKind != "" {
		kind := enumValue(material.ID, "publication_deadline_kind", material.PublicationDeadlineKind, "at", "unlisted", "closed")
		at := millis(material.PublicationDeadlineAt)
		if (kind == "at") != (at != nil) {
			unknown(material.ID, "publication_deadline", material.PublicationDeadlineKind)
			return "unknown", nil
		}
		return kind, at
	}
	switch material.PublicationDeadline {
	case "", "unknown":
		return "unknown", nil
	case "no-deadline":
		return "unlisted", nil
	case "unavailable":
		return "closed", nil
	default:
		at, err := time.Parse(time.RFC3339, material.PublicationDeadline)
		if err == nil {
			return "at", millis(&at)
		}
		unknown(material.ID, "publication_deadline", material.PublicationDeadline)
		return "unknown", nil
	}
}

func displayedDeadline(kind string, at *int64) string {
	switch kind {
	case "at":
		return millisTime(at).Format(time.RFC3339)
	case "closed":
		return "unavailable"
	case "unlisted":
		return "no-deadline"
	default:
		return "unknown"
	}
}

func nonnegative(id, field string, value *int64) *int64 {
	if value != nil && *value < 0 {
		unknown(id, field, *value)
		return nil
	}
	return value
}

func lecture(course domain.Course) (string, *int64, *int64) {
	kind := enumValue(course.ID, "type", course.Type, "scheduled", "other")
	if kind == "scheduled" {
		if course.Weekday != nil && *course.Weekday >= 1 && *course.Weekday <= 7 && course.Period != nil && *course.Period >= 1 {
			return kind, course.Weekday, course.Period
		}
		unknown(course.ID, "schedule", []any{course.Weekday, course.Period})
		kind = "unknown"
	}
	return kind, nil, nil
}

// Dates supplied to the archive are calendar dates, never fabricated midnight instants.
func folderDate(folder domain.Folder) *string {
	value := strings.TrimSpace(folder.ClassDate)
	return dateOnly(folder.Name, "class_date", &value)
}
