package sqlite

import (
	"bytes"
	"context"
	"log/slog"
	"strings"
	"testing"
)

func TestUnknownValuesAreLoggedWithoutPersistingRawText(t *testing.T) {
	var logs bytes.Buffer
	previous := slog.Default()
	slog.SetDefault(slog.New(slog.NewJSONHandler(&logs, nil)))
	t.Cleanup(func() { slog.SetDefault(previous) })
	s := newStore(t)
	snapshot := archiveSnapshot()
	snapshot.Materials.Folders[0].ClassDate = "invalid-date-marker"
	m := &snapshot.Materials.Folders[0].Materials[0]
	m.Type, m.Status, m.PublicationDeadline = "new-type-marker", "new-status-marker", "invalid-deadline-marker"
	snapshot.Resources[0].Status = "partially-viewed"
	invalid := "invalid-resource-date-marker"
	snapshot.Resources[0].RegisteredOn = &invalid
	if _, err := s.Append(context.Background(), snapshot); err != nil {
		t.Fatal(err)
	}
	var kind, status, deadline string
	if err := s.db.QueryRow("SELECT type,status,publication_deadline_kind FROM course_materials").
		Scan(&kind, &status, &deadline); err != nil || kind != "unknown" || status != "unknown" ||
		deadline != "unknown" {
		t.Fatal(kind, status, deadline, err)
	}
	var date *string
	if err := s.db.QueryRow("SELECT class_date FROM course_material_folders").
		Scan(&date); err != nil ||
		date != nil {
		t.Fatal(date, err)
	}
	var resourceStatus string
	if err := s.db.QueryRow("SELECT status, registered_on FROM material_resources WHERE lms_resource_id = 'SRS1'").
		Scan(&resourceStatus, &date); err != nil ||
		resourceStatus != "unknown" ||
		date != nil {
		t.Fatal(resourceStatus, date, err)
	}
	for _, raw := range []string{"invalid-date-marker", "new-type-marker", "new-status-marker", "invalid-deadline-marker", "partially-viewed", "invalid-resource-date-marker"} {
		if !strings.Contains(logs.String(), raw) {
			t.Fatalf("missing diagnostic %s: %s", raw, logs.String())
		}
	}
}
