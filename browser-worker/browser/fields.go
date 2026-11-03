package browser

import (
	"math"
	"net/url"
	"regexp"
	"time"

	workerproto "github.com/futsuuu/ku-potato/browser-worker/protocol"
	"google.golang.org/protobuf/types/known/emptypb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

var (
	materialID = regexp.MustCompile(`^[A-Z]+\d+$`)
	resourceID = regexp.MustCompile(`^SRS\d+$`)
)

func course(name, id, schedule string, weekday, period *int64) (*workerproto.Course, error) {
	result := &workerproto.Course{Name: name}
	if id == "" {
		result.Access = &workerproto.Course_Unavailable{Unavailable: &emptypb.Empty{}}
	} else {
		if len(id) > 200 {
			return nil, Fail(workerproto.FailureReason_FAILURE_REASON_SOURCE, "講義IDが不正です。")
		}
		result.Access = &workerproto.Course_Available{Available: &workerproto.CourseId{Value: id}}
	}
	switch schedule {
	case "scheduled":
		if weekday == nil || period == nil || *weekday < 1 || *weekday > 7 || *period < 1 ||
			*period > math.MaxInt32 {
			return nil, Fail(workerproto.FailureReason_FAILURE_REASON_SOURCE, "講義の時間割が不正です。")
		}
		result.Schedule = &workerproto.Course_Scheduled{
			Scheduled: &workerproto.Schedule{Weekday: int32(*weekday), Period: int32(*period)},
		}
	case "other":
		result.Schedule = &workerproto.Course_Other{Other: &emptypb.Empty{}}
	case "unknown":
		result.Schedule = &workerproto.Course_UnknownSchedule{UnknownSchedule: &emptypb.Empty{}}
	default:
		return nil, Fail(workerproto.FailureReason_FAILURE_REASON_SOURCE, "講義の時間割が不正です。")
	}
	return result, nil
}

func calendarDate(value string) (*workerproto.CalendarDate, error) {
	if value == "" {
		return nil, nil
	}
	parsed, err := time.Parse("2006-01-02", value)
	if err != nil || parsed.Format("2006-01-02") != value {
		return nil, Fail(workerproto.FailureReason_FAILURE_REASON_SOURCE, "LMSの日付を解析できません。")
	}
	return &workerproto.CalendarDate{
		Year:  int32(parsed.Year()),
		Month: int32(parsed.Month()),
		Day:   int32(parsed.Day()),
	}, nil
}

func publicationDeadline(value string) (*workerproto.PublicationDeadline, error) {
	result := &workerproto.PublicationDeadline{}
	switch value {
	case "", "unknown":
		result.Value = &workerproto.PublicationDeadline_Unknown{Unknown: &emptypb.Empty{}}
	case "no-deadline":
		result.Value = &workerproto.PublicationDeadline_Unlisted{Unlisted: &emptypb.Empty{}}
	case "unavailable":
		result.Value = &workerproto.PublicationDeadline_Closed{Closed: &emptypb.Empty{}}
	default:
		date, err := time.Parse(time.RFC3339, value)
		if err != nil {
			return nil, Fail(workerproto.FailureReason_FAILURE_REASON_SOURCE, "LMSの日付を解析できません。")
		}
		stamp := timestamppb.New(date)
		if stamp.CheckValid() != nil {
			return nil, Fail(workerproto.FailureReason_FAILURE_REASON_SOURCE, "LMSの日付を解析できません。")
		}
		result.Value = &workerproto.PublicationDeadline_At{At: stamp}
	}
	return result, nil
}

func material(raw rawMaterial, kind, deadline string) (*workerproto.Material, error) {
	if !materialID.MatchString(raw.ID) {
		return nil, Fail(workerproto.FailureReason_FAILURE_REASON_SOURCE, "教材IDが不正です。")
	}
	value, err := publicationDeadline(deadline)
	if err != nil {
		return nil, err
	}
	result := &workerproto.Material{
		Id:                    &workerproto.MaterialId{Value: raw.ID},
		Name:                  raw.Name,
		PublicationDeadline:   value,
		MaterialLinkAvailable: raw.Linked,
	}
	switch kind {
	case "material":
		availability := workerproto.LinkAvailability_LINK_AVAILABILITY_UNAVAILABLE
		if raw.Linked {
			availability = workerproto.LinkAvailability_LINK_AVAILABILITY_AVAILABLE
		}
		result.Kind = &workerproto.Material_Document{
			Document: &workerproto.DocumentMaterial{
				Status:               workerproto.DocumentStatus_DOCUMENT_STATUS_UNKNOWN,
				ResourceAvailability: availability,
			},
		}
	case "report":
		result.Kind = &workerproto.Material_Report{
			Report: &workerproto.ReportMaterial{
				Status: workerproto.ReportMaterialStatus_REPORT_MATERIAL_STATUS_UNKNOWN,
			},
		}
	case "test":
		result.Kind = &workerproto.Material_Test{
			Test: &workerproto.TestMaterial{Status: workerproto.TestStatus_TEST_STATUS_UNKNOWN},
		}
	case "questionnaire":
		result.Kind = &workerproto.Material_Questionnaire{
			Questionnaire: &workerproto.QuestionnaireMaterial{
				Status: workerproto.QuestionnaireStatus_QUESTIONNAIRE_STATUS_UNKNOWN,
			},
		}
	case "e-learning":
		result.Kind = &workerproto.Material_ELearning{
			ELearning: &workerproto.ELearningMaterial{
				Status: workerproto.ELearningStatus_E_LEARNING_STATUS_UNKNOWN,
			},
		}
	case "board":
		result.Kind = &workerproto.Material_Board{
			Board: &workerproto.BoardMaterial{Status: workerproto.BoardStatus_BOARD_STATUS_UNKNOWN},
		}
	case "feedback":
		result.Kind = &workerproto.Material_Feedback{
			Feedback: &workerproto.FeedbackMaterial{
				Status: workerproto.FeedbackStatus_FEEDBACK_STATUS_UNKNOWN,
			},
		}
	case "unknown":
		result.Kind = &workerproto.Material_Unknown{Unknown: &emptypb.Empty{}}
	default:
		return nil, Fail(workerproto.FailureReason_FAILURE_REASON_SOURCE, "未対応の教材種別です。")
	}
	return result, nil
}

func resource(id, name, kind, rawURL string) (*workerproto.Resource, error) {
	if !resourceID.MatchString(id) {
		return nil, Fail(workerproto.FailureReason_FAILURE_REASON_SOURCE, "資料IDが不正です。")
	}
	result := &workerproto.Resource{
		Id:     &workerproto.ResourceId{Value: id},
		Name:   name,
		Status: workerproto.ResourceStatus_RESOURCE_STATUS_UNKNOWN,
	}
	switch kind {
	case "ファイル資料":
		result.Content = &workerproto.Resource_File{File: &workerproto.ResourceFile{Url: rawURL}}
	case "外部資料":
		parsed, err := url.Parse(rawURL)
		if err != nil || parsed.Host == "" ||
			(parsed.Scheme != "http" && parsed.Scheme != "https") {
			return nil, Fail(
				workerproto.FailureReason_FAILURE_REASON_SOURCE,
				"外部資料URLはHTTP(S)である必要があります。",
			)
		}
		result.Content = &workerproto.Resource_ExternalUrl{ExternalUrl: rawURL}
	default:
		result.Content = &workerproto.Resource_Unknown{
			Unknown: &workerproto.ResourceUnknown{Url: rawURL},
		}
	}
	return result, nil
}
