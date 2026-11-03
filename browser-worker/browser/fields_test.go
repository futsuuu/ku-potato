package browser

import (
	"reflect"
	"testing"
	"time"

	workerproto "github.com/futsuuu/ku-potato/browser-worker/protocol"
)

func TestMaterialKindsUseProtocolVariants(t *testing.T) {
	for _, tc := range []struct {
		kind string
		wire any
	}{
		{"material", &workerproto.Material_Document{}},
		{"report", &workerproto.Material_Report{}},
		{"test", &workerproto.Material_Test{}},
		{"questionnaire", &workerproto.Material_Questionnaire{}},
		{"e-learning", &workerproto.Material_ELearning{}},
		{"board", &workerproto.Material_Board{}},
		{"feedback", &workerproto.Material_Feedback{}},
		{"unknown", &workerproto.Material_Unknown{}},
	} {
		t.Run(tc.kind, func(t *testing.T) {
			value, err := material(
				rawMaterial{ID: "SRY1", Name: "handout", Linked: true},
				tc.kind,
				"unknown",
			)
			if err != nil || reflect.TypeOf(value.GetKind()) != reflect.TypeOf(tc.wire) {
				t.Fatalf("unexpected protocol variant: %T (%v)", value.GetKind(), err)
			}
		})
	}
}

func TestProtocolFieldsPreserveAbsenceAndRejectInvalidValues(t *testing.T) {
	date, err := publicationDeadline("2026-10-31T15:00:00Z")
	if err != nil || !date.GetAt().AsTime().Equal(time.Date(2026, 10, 31, 15, 0, 0, 0, time.UTC)) {
		t.Fatalf("publication deadline: %v (%v)", date, err)
	}
	for _, value := range []string{"2026-02-30", "10000-01-01", "not-a-date"} {
		if _, err := calendarDate(value); err == nil {
			t.Fatalf("invalid calendar date accepted: %s", value)
		}
	}
	if _, err := course("invalid", "KOG1", "scheduled", nil, nil); err == nil {
		t.Fatal("missing schedule accepted")
	}
	if _, err := material(rawMaterial{ID: "bad"}, "material", "unknown"); err == nil {
		t.Fatal("invalid material ID accepted")
	}
	if _, err := resource("SRS1", "external", "外部資料", "javascript:alert(1)"); err == nil {
		t.Fatal("invalid external URL accepted")
	}
	unfetched := &workerproto.Snapshot{}
	fetchedEmpty := &workerproto.Snapshot{
		ResourceList: &workerproto.ResourceList{Resources: []*workerproto.Resource{}},
	}
	if unfetched.GetResourceList() != nil || fetchedEmpty.GetResourceList() == nil {
		t.Fatal("unfetched and fetched-empty resources are indistinguishable")
	}
}
