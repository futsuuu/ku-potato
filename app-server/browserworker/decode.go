package browserworker

import (
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/futsuuu/ku-potato/app-server/domain"
	"github.com/futsuuu/ku-potato/browser-worker/protocol"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func malformed() error {
	return domain.Fail("source", "ブラウザワーカーの取得結果が不正です。")
}

var (
	materialID = regexp.MustCompile(`^[A-Z]+\d+$`)
	resourceID = regexp.MustCompile(`^SRS\d+$`)
)

func courseID(value *workerproto.CourseId) (string, error) {
	if value == nil || value.GetValue() == "" || len(value.GetValue()) > 200 {
		return "", malformed()
	}
	return value.GetValue(), nil
}

func parsedMaterialID(value *workerproto.MaterialId) (string, error) {
	if value == nil || !materialID.MatchString(value.GetValue()) {
		return "", malformed()
	}
	return value.GetValue(), nil
}

func parsedResourceID(value *workerproto.ResourceId) (string, error) {
	if value == nil || !resourceID.MatchString(value.GetValue()) {
		return "", malformed()
	}
	return value.GetValue(), nil
}

func externalURL(raw string) (string, error) {
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return "", malformed()
	}
	return raw, nil
}

func fromEnum[T ~int32](value T, prefix string, names map[int32]string) (string, error) {
	name, ok := names[int32(value)]
	if !ok || value == 0 || !strings.HasPrefix(name, prefix) {
		return "", malformed()
	}
	return strings.ToLower(strings.ReplaceAll(strings.TrimPrefix(name, prefix), "_", "-")), nil
}

func fromTimestamp(value *timestamppb.Timestamp) (*time.Time, error) {
	if value == nil {
		return nil, nil
	}
	if value.CheckValid() != nil {
		return nil, malformed()
	}
	date := value.AsTime()
	return &date, nil
}

func fromDate(value *workerproto.CalendarDate) (string, error) {
	if value == nil {
		return "", nil
	}
	if value.GetYear() < 1 || value.GetYear() > 9999 || value.GetMonth() < 1 ||
		value.GetMonth() > 12 ||
		value.GetDay() < 1 ||
		value.GetDay() > 31 {
		return "", malformed()
	}
	parsed := time.Date(
		int(value.GetYear()),
		time.Month(value.GetMonth()),
		int(value.GetDay()),
		0,
		0,
		0,
		0,
		time.UTC,
	)
	if int32(parsed.Year()) != value.GetYear() || int32(parsed.Month()) != value.GetMonth() ||
		int32(parsed.Day()) != value.GetDay() {
		return "", malformed()
	}
	return parsed.Format("2006-01-02"), nil
}

func fromCourse(value *workerproto.Course, year int) (domain.Course, error) {
	if value == nil || year < 1 || year > 9999 {
		return domain.Course{}, malformed()
	}
	result := domain.Course{Name: value.GetName(), AcademicYear: year}
	switch access := value.GetAccess().(type) {
	case *workerproto.Course_Available:
		id, err := courseID(access.Available)
		if err != nil {
			return result, err
		}
		result.ID, result.Availability = id, "available"
	case *workerproto.Course_Unavailable:
		if access.Unavailable == nil {
			return result, malformed()
		}
		result.Availability = "unavailable"
	default:
		return result, malformed()
	}
	switch schedule := value.GetSchedule().(type) {
	case *workerproto.Course_Scheduled:
		if schedule.Scheduled == nil || schedule.Scheduled.Weekday < 1 ||
			schedule.Scheduled.Weekday > 7 ||
			schedule.Scheduled.Period < 1 {
			return result, malformed()
		}
		weekday, period := int64(schedule.Scheduled.Weekday), int64(schedule.Scheduled.Period)
		result.Type, result.Weekday, result.Period = "scheduled", &weekday, &period
	case *workerproto.Course_Other:
		if schedule.Other == nil {
			return result, malformed()
		}
		result.Type = "other"
	case *workerproto.Course_UnknownSchedule:
		if schedule.UnknownSchedule == nil {
			return result, malformed()
		}
		result.Type = "unknown"
	default:
		return result, malformed()
	}
	return result, nil
}

func decodeListing(value *workerproto.CourseListing) (domain.CourseListing, error) {
	if value == nil || value.GetAcademicYear() < 1 || value.GetAcademicYear() > 9999 {
		return domain.CourseListing{}, malformed()
	}
	result := domain.CourseListing{
		AcademicYear: int(value.GetAcademicYear()),
		Courses:      []domain.Course{},
	}
	for _, course := range value.GetCourses() {
		item, err := fromCourse(course, result.AcademicYear)
		if err != nil {
			return domain.CourseListing{}, err
		}
		result.Courses = append(result.Courses, item)
	}
	return result, nil
}

func fromDeadline(value *workerproto.PublicationDeadline) (string, string, *time.Time, error) {
	if value == nil {
		return "", "", nil, malformed()
	}
	switch variant := value.GetValue().(type) {
	case *workerproto.PublicationDeadline_At:
		if variant.At == nil {
			return "", "", nil, malformed()
		}
		at, err := fromTimestamp(variant.At)
		if err != nil {
			return "", "", nil, err
		}
		return at.Format(time.RFC3339), "at", at, nil
	case *workerproto.PublicationDeadline_Unlisted:
		if variant.Unlisted == nil {
			break
		}
		return "no-deadline", "unlisted", nil, nil
	case *workerproto.PublicationDeadline_Closed:
		if variant.Closed == nil {
			break
		}
		return "unavailable", "closed", nil, nil
	case *workerproto.PublicationDeadline_Unknown:
		if variant.Unknown == nil {
			break
		}
		return "unknown", "", nil, nil
	}
	return "", "", nil, malformed()
}

func fromMaterial(value *workerproto.Material) (domain.Material, error) {
	if value == nil {
		return domain.Material{}, malformed()
	}
	id, err := parsedMaterialID(value.GetId())
	if err != nil {
		return domain.Material{}, err
	}
	deadline, deadlineKind, at, err := fromDeadline(value.GetPublicationDeadline())
	if err != nil {
		return domain.Material{}, err
	}
	result := domain.Material{
		ID:                      id,
		Name:                    value.GetName(),
		PublicationDeadline:     deadline,
		PublicationDeadlineKind: deadlineKind,
		PublicationDeadlineAt:   at,
		MaterialLinkAvailable:   value.GetMaterialLinkAvailable(),
	}
	switch kind := value.GetKind().(type) {
	case *workerproto.Material_Document:
		if kind.Document == nil {
			return domain.Material{}, malformed()
		}
		result.Type = "material"
		result.Status, err = fromEnum(
			kind.Document.GetStatus(),
			"DOCUMENT_STATUS_",
			workerproto.DocumentStatus_name,
		)
		switch kind.Document.GetResourceAvailability() {
		case workerproto.LinkAvailability_LINK_AVAILABILITY_UNSPECIFIED:
			return domain.Material{}, malformed()
		case workerproto.LinkAvailability_LINK_AVAILABILITY_AVAILABLE:
			result.ResourceAvailability = "available"
		case workerproto.LinkAvailability_LINK_AVAILABILITY_UNAVAILABLE:
			result.ResourceAvailability = "unavailable"
		default:
			return domain.Material{}, malformed()
		}
	case *workerproto.Material_Report:
		if kind.Report == nil {
			return domain.Material{}, malformed()
		}
		result.Type = "report"
		result.Status, err = fromEnum(
			kind.Report.GetStatus(),
			"REPORT_MATERIAL_STATUS_",
			workerproto.ReportMaterialStatus_name,
		)
	case *workerproto.Material_Test:
		if kind.Test == nil {
			return domain.Material{}, malformed()
		}
		result.Type = "test"
		result.Status, err = fromEnum(
			kind.Test.GetStatus(),
			"TEST_STATUS_",
			workerproto.TestStatus_name,
		)
	case *workerproto.Material_Questionnaire:
		if kind.Questionnaire == nil {
			return domain.Material{}, malformed()
		}
		result.Type = "questionnaire"
		result.Status, err = fromEnum(
			kind.Questionnaire.GetStatus(),
			"QUESTIONNAIRE_STATUS_",
			workerproto.QuestionnaireStatus_name,
		)
	case *workerproto.Material_ELearning:
		if kind.ELearning == nil {
			return domain.Material{}, malformed()
		}
		result.Type = "e-learning"
		result.Status, err = fromEnum(
			kind.ELearning.GetStatus(),
			"E_LEARNING_STATUS_",
			workerproto.ELearningStatus_name,
		)
	case *workerproto.Material_Board:
		if kind.Board == nil {
			return domain.Material{}, malformed()
		}
		result.Type = "board"
		result.Status, err = fromEnum(
			kind.Board.GetStatus(),
			"BOARD_STATUS_",
			workerproto.BoardStatus_name,
		)
	case *workerproto.Material_Feedback:
		if kind.Feedback == nil {
			return domain.Material{}, malformed()
		}
		result.Type = "feedback"
		result.Status, err = fromEnum(
			kind.Feedback.GetStatus(),
			"FEEDBACK_STATUS_",
			workerproto.FeedbackStatus_name,
		)
	case *workerproto.Material_Unknown:
		if kind.Unknown == nil {
			return domain.Material{}, malformed()
		}
		result.Type, result.Status = "unknown", "unknown"
	default:
		return domain.Material{}, malformed()
	}
	if err != nil {
		return domain.Material{}, err
	}
	return result, nil
}

func fromMaterials(value *workerproto.CourseMaterials) (*domain.CourseMaterials, error) {
	if value == nil {
		return nil, nil
	}
	id, err := courseID(value.GetCourseId())
	if err != nil {
		return nil, err
	}
	result := &domain.CourseMaterials{CourseID: id, Folders: []domain.Folder{}}
	for _, folder := range value.GetFolders() {
		if folder == nil {
			return nil, malformed()
		}
		date, err := fromDate(folder.GetClassDate())
		if err != nil {
			return nil, err
		}
		item := domain.Folder{
			Name:            folder.GetName(),
			ClassDate:       date,
			DescriptionHTML: folder.DescriptionHtml,
			Materials:       []domain.Material{},
		}
		for _, m := range folder.GetMaterials() {
			decoded, err := fromMaterial(m)
			if err != nil {
				return nil, err
			}
			item.Materials = append(item.Materials, decoded)
		}
		result.Folders = append(result.Folders, item)
	}
	return result, nil
}

func fromDateValue(value *workerproto.CalendarDate) (*string, error) {
	if value == nil {
		return nil, nil
	}
	date, err := fromDate(value)
	if err != nil {
		return nil, err
	}
	return &date, nil
}

func fromResource(value *workerproto.Resource) (domain.RetrievedResource, error) {
	if value == nil {
		return domain.RetrievedResource{}, malformed()
	}
	id, err := parsedResourceID(value.GetId())
	if err != nil {
		return domain.RetrievedResource{}, err
	}
	status, err := fromEnum(value.GetStatus(), "RESOURCE_STATUS_", workerproto.ResourceStatus_name)
	if err != nil {
		return domain.RetrievedResource{}, err
	}
	registered, err := fromDateValue(value.GetRegisteredOn())
	if err != nil {
		return domain.RetrievedResource{}, err
	}
	viewed, err := fromDateValue(value.GetFirstViewedOn())
	if err != nil {
		return domain.RetrievedResource{}, err
	}
	result := domain.RetrievedResource{
		ID:            id,
		Name:          value.GetName(),
		Status:        status,
		RegisteredOn:  registered,
		FirstViewedOn: viewed,
		Description:   value.Description,
	}
	switch content := value.GetContent().(type) {
	case *workerproto.Resource_File:
		if content.File == nil {
			return domain.RetrievedResource{}, malformed()
		}
		result.Type, result.URL = "file", content.File.GetUrl()
	case *workerproto.Resource_ExternalUrl:
		url, err := externalURL(content.ExternalUrl)
		if err != nil {
			return domain.RetrievedResource{}, err
		}
		result.Type, result.URL = "external", url
	case *workerproto.Resource_Unknown:
		if content.Unknown == nil {
			return domain.RetrievedResource{}, malformed()
		}
		result.Type, result.URL = "unknown", content.Unknown.GetUrl()
	default:
		return domain.RetrievedResource{}, malformed()
	}
	return result, nil
}

func fromSubmissionPeriod(
	value *workerproto.SubmissionPeriod,
) (string, *time.Time, *time.Time, error) {
	if value == nil {
		return "", nil, nil, malformed()
	}
	switch kind := value.GetKind().(type) {
	case *workerproto.SubmissionPeriod_At:
		if kind.At == nil {
			break
		}
		start, err := fromTimestamp(kind.At.GetStartsAt())
		if err != nil {
			return "", nil, nil, err
		}
		due, err := fromTimestamp(kind.At.GetDueAt())
		if err != nil {
			return "", nil, nil, err
		}
		if start == nil && due == nil {
			break
		}
		if start != nil && due != nil && due.Before(*start) {
			break
		}
		return "at", start, due, nil
	case *workerproto.SubmissionPeriod_Unlisted:
		if kind.Unlisted != nil {
			return "unlisted", nil, nil, nil
		}
	case *workerproto.SubmissionPeriod_Unknown:
		if kind.Unknown != nil {
			return "unknown", nil, nil, nil
		}
	}
	return "", nil, nil, malformed()
}

func fromCorrectionPolicy(value *workerproto.CorrectionPolicy) (string, *int64, error) {
	if value == nil {
		return "", nil, malformed()
	}
	switch kind := value.GetKind().(type) {
	case *workerproto.CorrectionPolicy_Unknown:
		if kind.Unknown != nil {
			return "unknown", nil, nil
		}
	case *workerproto.CorrectionPolicy_NotAllowed:
		if kind.NotAllowed != nil {
			return "not-allowed", nil, nil
		}
	case *workerproto.CorrectionPolicy_Unlimited:
		if kind.Unlimited != nil {
			return "unlimited", nil, nil
		}
	case *workerproto.CorrectionPolicy_Limited:
		if kind.Limited >= 0 {
			limit := kind.Limited
			return "limited", &limit, nil
		}
	}
	return "", nil, malformed()
}

func fromReport(value *workerproto.Report) (*domain.ReportDetail, error) {
	if value == nil {
		return nil, nil
	}
	status, err := fromEnum(value.GetStatus(), "REPORT_STATUS_", workerproto.ReportStatus_name)
	if err != nil {
		return nil, err
	}
	kind, start, due, err := fromSubmissionPeriod(value.GetSubmissionPeriod())
	if err != nil {
		return nil, err
	}
	mode, limit, err := fromCorrectionPolicy(value.GetCorrectionPolicy())
	if err != nil {
		return nil, err
	}
	if value.MaxTotalFileBytes != nil && *value.MaxTotalFileBytes < 0 {
		return nil, malformed()
	}
	return &domain.ReportDetail{
		PromptHTML:           value.PromptHtml,
		Status:               status,
		SubmissionPeriodKind: kind,
		SubmissionStartsAt:   start,
		SubmissionDueAt:      due,
		CorrectionMode:       mode,
		CorrectionLimit:      limit,
		TextAnswerAllowed:    value.TextAnswerAllowed,
		FileAnswerAllowed:    value.FileAnswerAllowed,
		MaxTotalFileBytes:    value.MaxTotalFileBytes,
	}, nil
}

func decodeSnapshot(value *workerproto.Snapshot) (domain.Snapshot, error) {
	if value == nil || value.GetAcademicYear() < 0 || value.GetAcademicYear() > 9999 {
		return domain.Snapshot{}, malformed()
	}
	materials, err := fromMaterials(value.GetCourseMaterials())
	if err != nil {
		return domain.Snapshot{}, err
	}
	report, err := fromReport(value.GetReport())
	if err != nil {
		return domain.Snapshot{}, err
	}
	result := domain.Snapshot{
		AcademicYear: int(value.GetAcademicYear()),
		Courses:      []domain.Course{},
		Materials:    materials,
		Report:       report,
	}
	if value.GetMaterialId() != nil {
		id, err := parsedMaterialID(value.GetMaterialId())
		if err != nil {
			return domain.Snapshot{}, err
		}
		result.MaterialID = id
	}
	for _, course := range value.GetCourses() {
		item, err := fromCourse(course, result.AcademicYear)
		if err != nil {
			return domain.Snapshot{}, err
		}
		result.Courses = append(result.Courses, item)
	}
	if value.GetResourceList() != nil {
		result.Resources = []domain.RetrievedResource{}
		for _, resource := range value.GetResourceList().GetResources() {
			item, err := fromResource(resource)
			if err != nil {
				return domain.Snapshot{}, err
			}
			result.Resources = append(result.Resources, item)
		}
	}
	return result, nil
}

func decodeFailure(value *workerproto.Failure) error {
	if value == nil {
		return malformed()
	}
	reason, err := fromEnum(value.GetReason(), "FAILURE_REASON_", workerproto.FailureReason_name)
	if err != nil {
		return err
	}
	return domain.Fail(reason, value.GetMessage())
}
