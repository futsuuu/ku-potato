package domain

// MaterialStatuses defines the student-visible statuses for each material type.
func MaterialStatuses(kind string) []string {
	switch kind {
	case "material":
		return []string{"unviewed", "viewed", "partially-viewed", "unknown"}
	case "report":
		return []string{"unviewed", "unsubmitted", "submitted", "resubmission-required", "evaluated", "unknown"}
	case "test", "e-learning":
		return []string{"not-started", "in-progress", "completed", "unknown"}
	case "questionnaire":
		return []string{"unanswered", "answered", "unknown"}
	case "board":
		return []string{"unposted", "evaluated", "unknown"}
	case "feedback":
		return []string{"unevaluated", "evaluated", "unknown"}
	default:
		return []string{"unknown"}
	}
}
