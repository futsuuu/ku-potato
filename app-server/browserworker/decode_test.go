package browserworker

import (
	"reflect"
	"testing"
	"time"

	workerproto "github.com/futsuuu/ku-potato/browser-worker/protocol"
	"google.golang.org/protobuf/types/known/emptypb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func TestMaterialVariantsDecodeTheirOwnStatuses(t *testing.T) {
	cases := []struct {
		kind         any
		wantType     string
		wantStatus   string
		availability string
	}{
		{
			&workerproto.Material_Document{
				Document: &workerproto.DocumentMaterial{
					Status:               workerproto.DocumentStatus_DOCUMENT_STATUS_PARTIALLY_VIEWED,
					ResourceAvailability: workerproto.LinkAvailability_LINK_AVAILABILITY_AVAILABLE,
				},
			},
			"material",
			"partially-viewed",
			"available",
		},
		{
			&workerproto.Material_Report{
				Report: &workerproto.ReportMaterial{
					Status: workerproto.ReportMaterialStatus_REPORT_MATERIAL_STATUS_SUBMITTED,
				},
			},
			"report",
			"submitted",
			"",
		},
		{
			&workerproto.Material_Test{
				Test: &workerproto.TestMaterial{
					Status: workerproto.TestStatus_TEST_STATUS_IN_PROGRESS,
				},
			},
			"test",
			"in-progress",
			"",
		},
		{
			&workerproto.Material_Questionnaire{
				Questionnaire: &workerproto.QuestionnaireMaterial{
					Status: workerproto.QuestionnaireStatus_QUESTIONNAIRE_STATUS_ANSWERED,
				},
			},
			"questionnaire",
			"answered",
			"",
		},
		{
			&workerproto.Material_ELearning{
				ELearning: &workerproto.ELearningMaterial{
					Status: workerproto.ELearningStatus_E_LEARNING_STATUS_COMPLETED,
				},
			},
			"e-learning",
			"completed",
			"",
		},
		{
			&workerproto.Material_Board{
				Board: &workerproto.BoardMaterial{
					Status: workerproto.BoardStatus_BOARD_STATUS_UNPOSTED,
				},
			},
			"board",
			"unposted",
			"",
		},
		{
			&workerproto.Material_Feedback{
				Feedback: &workerproto.FeedbackMaterial{
					Status: workerproto.FeedbackStatus_FEEDBACK_STATUS_UNEVALUATED,
				},
			},
			"feedback",
			"unevaluated",
			"",
		},
		{&workerproto.Material_Unknown{Unknown: &emptypb.Empty{}}, "unknown", "unknown", ""},
	}
	for _, tc := range cases {
		t.Run(tc.wantType, func(t *testing.T) {
			value := &workerproto.Material{
				Id: &workerproto.MaterialId{Value: "SRY1"},
				PublicationDeadline: &workerproto.PublicationDeadline{
					Value: &workerproto.PublicationDeadline_Unknown{Unknown: &emptypb.Empty{}},
				},
			}
			switch kind := tc.kind.(type) {
			case *workerproto.Material_Document:
				value.Kind = kind
			case *workerproto.Material_Report:
				value.Kind = kind
			case *workerproto.Material_Test:
				value.Kind = kind
			case *workerproto.Material_Questionnaire:
				value.Kind = kind
			case *workerproto.Material_ELearning:
				value.Kind = kind
			case *workerproto.Material_Board:
				value.Kind = kind
			case *workerproto.Material_Feedback:
				value.Kind = kind
			case *workerproto.Material_Unknown:
				value.Kind = kind
			default:
				t.Fatal("missing test variant")
			}
			got, err := fromMaterial(value)
			if err != nil || got.Type != tc.wantType || got.Status != tc.wantStatus ||
				got.ResourceAvailability != tc.availability {
				t.Fatalf("wrong material: %+v (%v)", got, err)
			}
		})
	}
}

func TestDecodeSnapshotKeepsPresenceAndCorrectionLimit(t *testing.T) {
	encoded := &workerproto.Snapshot{
		ResourceList: &workerproto.ResourceList{},
		Report: &workerproto.Report{
			Status: workerproto.ReportStatus_REPORT_STATUS_UNKNOWN,
			SubmissionPeriod: &workerproto.SubmissionPeriod{
				Kind: &workerproto.SubmissionPeriod_Unlisted{Unlisted: &emptypb.Empty{}},
			},
			CorrectionPolicy: &workerproto.CorrectionPolicy{
				Kind: &workerproto.CorrectionPolicy_Limited{Limited: 0},
			},
		},
	}
	got, err := decodeSnapshot(encoded)
	if err != nil || got.Resources == nil || len(got.Resources) != 0 || got.Report == nil ||
		got.Report.CorrectionLimit == nil ||
		*got.Report.CorrectionLimit != 0 {
		t.Fatalf("lost present empty fields: %+v (%v)", got, err)
	}
	encoded.ResourceList = nil
	got, err = decodeSnapshot(encoded)
	if err != nil || got.Resources != nil {
		t.Fatalf("unfetched resources became fetched: %+v (%v)", got, err)
	}
}

func TestMalformedWireValuesAreRejected(t *testing.T) {
	deadline := &workerproto.PublicationDeadline{
		Value: &workerproto.PublicationDeadline_Unlisted{Unlisted: &emptypb.Empty{}},
	}
	tests := []*workerproto.Material{
		{Id: &workerproto.MaterialId{Value: "SRY1"}, PublicationDeadline: deadline},
		{
			Id:                  &workerproto.MaterialId{Value: "SRY1"},
			PublicationDeadline: deadline,
			Kind: &workerproto.Material_Document{
				Document: &workerproto.DocumentMaterial{
					Status: workerproto.DocumentStatus_DOCUMENT_STATUS_UNKNOWN,
				},
			},
		},
		{
			Id:                  &workerproto.MaterialId{Value: "SRY1"},
			PublicationDeadline: deadline,
			Kind: &workerproto.Material_Document{
				Document: &workerproto.DocumentMaterial{
					Status:               workerproto.DocumentStatus_DOCUMENT_STATUS_UNSPECIFIED,
					ResourceAvailability: workerproto.LinkAvailability_LINK_AVAILABILITY_AVAILABLE,
				},
			},
		},
		{
			Id:                  &workerproto.MaterialId{Value: "SRY1"},
			PublicationDeadline: deadline,
			Kind: &workerproto.Material_Report{
				Report: &workerproto.ReportMaterial{Status: workerproto.ReportMaterialStatus(999)},
			},
		},
	}
	for _, value := range tests {
		if _, err := fromMaterial(value); err == nil {
			t.Fatalf("accepted malformed material: %+v", value)
		}
	}
	if _, err := fromCourse(&workerproto.Course{}, 2026); err == nil {
		t.Fatal("missing course union accepted")
	}
	if _, err := fromDate(&workerproto.CalendarDate{Year: 2026, Month: 2, Day: 30}); err == nil {
		t.Fatal("invalid date accepted")
	}
	if _, err := fromTimestamp(&timestamppb.Timestamp{Seconds: 253402300800}); err == nil {
		t.Fatal("invalid timestamp accepted")
	}
	if _, err := decodeSnapshot(
		&workerproto.Snapshot{
			Report: &workerproto.Report{
				Status: workerproto.ReportStatus_REPORT_STATUS_UNKNOWN,
				SubmissionPeriod: &workerproto.SubmissionPeriod{
					Kind: &workerproto.SubmissionPeriod_At{At: &workerproto.SubmissionWindow{}},
				},
				CorrectionPolicy: &workerproto.CorrectionPolicy{
					Kind: &workerproto.CorrectionPolicy_Unknown{Unknown: &emptypb.Empty{}},
				},
			},
		},
	); err == nil {
		t.Fatal("empty submission window accepted")
	}
	if err := decodeFailure(&workerproto.Failure{}); err == nil {
		t.Fatal("unspecified failure accepted")
	}
}

func TestDecodeDatesAndResourceContents(t *testing.T) {
	date := &workerproto.CalendarDate{Year: 2026, Month: 10, Day: 28}
	resources := []*workerproto.Resource{
		{
			Id:           &workerproto.ResourceId{Value: "SRS1"},
			Status:       workerproto.ResourceStatus_RESOURCE_STATUS_UNVIEWED,
			RegisteredOn: date,
			Content: &workerproto.Resource_File{
				File: &workerproto.ResourceFile{Url: "https://example.com/file"},
			},
		},
		{
			Id:      &workerproto.ResourceId{Value: "SRS2"},
			Status:  workerproto.ResourceStatus_RESOURCE_STATUS_VIEWED,
			Content: &workerproto.Resource_ExternalUrl{ExternalUrl: "https://example.com/view"},
		},
		{
			Id:      &workerproto.ResourceId{Value: "SRS3"},
			Status:  workerproto.ResourceStatus_RESOURCE_STATUS_UNKNOWN,
			Content: &workerproto.Resource_Unknown{Unknown: &workerproto.ResourceUnknown{}},
		},
	}
	got, err := decodeSnapshot(
		&workerproto.Snapshot{ResourceList: &workerproto.ResourceList{Resources: resources}},
	)
	if err != nil || len(got.Resources) != 3 || got.Resources[0].RegisteredOn == nil ||
		*got.Resources[0].RegisteredOn != "2026-10-28" ||
		got.Resources[0].URL != "https://example.com/file" ||
		got.Resources[1].Type != "external" ||
		got.Resources[2].Type != "unknown" {
		t.Fatalf("resource metadata changed: %+v (%v)", got.Resources, err)
	}
	start := time.Date(2026, 10, 28, 15, 30, 0, 0, time.UTC)
	gotTime, err := fromTimestamp(timestamppb.New(start))
	if err != nil || !reflect.DeepEqual(gotTime, &start) {
		t.Fatalf("timestamp changed: %v (%v)", gotTime, err)
	}
}
