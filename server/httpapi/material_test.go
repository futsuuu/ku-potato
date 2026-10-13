package httpapi

import (
	"encoding/json"
	"reflect"
	"slices"
	"testing"

	"github.com/danielgtaylor/huma/v2"
	"github.com/futsuuu/ku-potato/server/domain"
)

func TestMaterialTypeConstrainsStatus(t *testing.T) {
	registry := huma.NewMapRegistry("#/components/schemas/", huma.DefaultSchemaNamer)
	registry.RegisterTypeAlias(reflect.TypeFor[domain.Material](), reflect.TypeFor[material]())
	schema := registry.Schema(reflect.TypeFor[domain.Material](), true, "")
	statuses := map[string][]string{
		"material":      {"unviewed", "viewed", "partially-viewed", "unknown"},
		"report":        {"unviewed", "unsubmitted", "submitted", "resubmission-required", "evaluated", "unknown"},
		"test":          {"not-started", "in-progress", "completed", "unknown"},
		"questionnaire": {"unanswered", "answered", "unknown"},
		"e-learning":    {"not-started", "in-progress", "completed", "unknown"},
		"board":         {"unposted", "evaluated", "unknown"},
		"feedback":      {"unevaluated", "evaluated", "unknown"},
		"unknown":       {"unknown"},
	}
	validate := func(value map[string]any) bool {
		t.Helper()
		result := &huma.ValidateResult{}
		huma.Validate(registry, schema, huma.NewPathBuffer(nil, 0), huma.ModeReadFromServer, value, result)
		return len(result.Errors) == 0
	}
	for kind, allowed := range statuses {
		for _, status := range []string{"unviewed", "viewed", "partially-viewed", "unsubmitted", "submitted", "resubmission-required", "evaluated", "not-started", "in-progress", "completed", "unanswered", "answered", "unposted", "unevaluated", "unknown", "evaluating", "invalid", ""} {
			t.Run(kind+"/"+status, func(t *testing.T) {
				body, err := json.Marshal(domain.Material{ID: "MAT1", Name: "material", Type: kind, Status: status, PublicationDeadline: "no-deadline"})
				if err != nil {
					t.Fatal(err)
				}
				var value map[string]any
				if err := json.Unmarshal(body, &value); err != nil {
					t.Fatal(err)
				}
				if valid := validate(value); valid != slices.Contains(allowed, status) {
					t.Fatalf("unexpected validation for type=%s status=%s: valid=%v", kind, status, valid)
				}
				if status == "unknown" {
					delete(value, "status")
					if validate(value) {
						t.Fatal("missing status was accepted")
					}
				}
			})
		}
	}
}
