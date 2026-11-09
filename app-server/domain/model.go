package domain

import (
	"errors"
	"time"
)

var ErrMissing = errors.New("archive-data-missing")

type AuthenticationError struct {
	Provider string
	Err      error
}

func (e *AuthenticationError) Error() string { return e.Err.Error() }
func (e *AuthenticationError) Unwrap() error { return e.Err }

type Error struct {
	Reason  string `json:"reason" enum:"invalid-input,conflict,authentication-required,archive-data-missing,material-not-found,resource-not-found,course-not-found,unsupported-resource,source,timeout,internal,archive,authentication-storage,resource-storage,not-found,forbidden,browser-start"`
	Message string `json:"message"`
}

func (e *Error) Error() string          { return e.Message }
func Fail(reason, message string) error { return &Error{reason, message} }

type Course struct {
	ID           string `json:"lmsCourseId,omitempty"`
	Name         string `json:"name"`
	Availability string `json:"availability" enum:"available,unavailable"`
	Archived     bool   `json:"archived,omitempty"`
	AcademicYear int    `json:"academicYear,omitempty" minimum:"1" maximum:"9999"`
	Type         string `json:"type,omitempty" enum:"scheduled,other,unknown"`
	Weekday      *int64 `json:"weekday,omitempty" minimum:"1" maximum:"7"`
	Period       *int64 `json:"period,omitempty" minimum:"1"`
}

// CourseListing retains the selected year even when HOME contains no cards.
type CourseListing struct {
	AcademicYear int
	Courses      []Course
}

type Material struct {
	ID                      string     `json:"lmsMaterialId"`
	Name                    string     `json:"name"`
	Type                    string     `json:"type" enum:"material,report,test,questionnaire,e-learning,board,feedback,unknown"`
	PublicationDeadline     string     `json:"publicationDeadline"`
	PublicationDeadlineKind string     `json:"publicationDeadlineKind,omitempty" enum:"at,unlisted,closed,unknown"`
	PublicationDeadlineAt   *time.Time `json:"publicationDeadlineAt,omitempty"`
	Status                  string     `json:"status" enum:"unviewed,viewed,partially-viewed,unsubmitted,submitted,resubmission-required,evaluated,not-started,in-progress,completed,unanswered,answered,unposted,unevaluated,unknown"`
	MaterialLinkAvailable   bool       `json:"materialLinkAvailable"`
	ResourceAvailability    string     `json:"resourceAvailability,omitempty" enum:"available,unavailable"`
	RetrievedAt             *time.Time `json:"retrievedAt,omitempty"`
	Archived                bool       `json:"archived,omitempty"`
}
type Folder struct {
	Name            string     `json:"name"`
	ClassDate       string     `json:"classDate,omitempty" format:"date"`
	DescriptionHTML *string    `json:"descriptionHtml,omitempty"`
	Materials       []Material `json:"materials"`
}
type CourseMaterials struct {
	CourseID string   `json:"lmsCourseId"`
	Folders  []Folder `json:"folders"`
}

// SavedFile describes original bytes, independently of their local encoding.
type SavedFile struct {
	ContentHash      string `json:"contentHash"` // SHA-256 of the original bytes.
	OriginalFilename string `json:"originalFilename"`
	OriginalSize     int64  `json:"originalSize" minimum:"0"` // Bytes before storage compression.
}

// RetrievedResource contains LMS data to append to the resource retrieval history.
type RetrievedResource struct {
	ID            string  `json:"lmsResourceId"`
	Name          string  `json:"name"`
	Type          string  `json:"type" enum:"file,external,unknown"`
	Status        string  `json:"status,omitempty" enum:"unviewed,viewed,unknown"`
	RegisteredOn  *string `json:"registeredOn,omitempty" format:"date"`
	FirstViewedOn *string `json:"firstViewedOn,omitempty" format:"date"`
	Description   *string `json:"description,omitempty"`
	URL           string  `json:"url,omitempty" format:"uri" pattern:"^https?://"`
}

// Resource is assembled from retrieval history and the currently saved file.
type Resource struct {
	ID            string     `json:"lmsResourceId"`
	Name          string     `json:"name"`
	Type          string     `json:"type" enum:"file,external,unknown"`
	Status        string     `json:"status,omitempty" enum:"unviewed,viewed,unknown"`
	RegisteredOn  *string    `json:"registeredOn,omitempty" format:"date"`
	FirstViewedOn *string    `json:"firstViewedOn,omitempty" format:"date"`
	Description   *string    `json:"description,omitempty"`
	URL           string     `json:"url,omitempty" format:"uri" pattern:"^https?://"`
	Archived      bool       `json:"archived,omitempty"`
	SavedFile     *SavedFile `json:"savedFile,omitempty"`
}
type Detail struct {
	Course    Course        `json:"course"`
	Material  Material      `json:"material"`
	Resources []Resource    `json:"resources"`
	Report    *ReportDetail `json:"report,omitempty"`
}

type ReportDetail struct {
	PromptHTML           *string    `json:"promptHtml,omitempty"`
	Status               string     `json:"status" enum:"unviewed,unsubmitted,submitted,resubmission-required,evaluated,unknown"`
	SubmissionPeriodKind string     `json:"submissionPeriodKind" enum:"at,unlisted,unknown"`
	SubmissionStartsAt   *time.Time `json:"submissionStartsAt,omitempty"`
	SubmissionDueAt      *time.Time `json:"submissionDueAt,omitempty"`
	CorrectionMode       string     `json:"correctionMode" enum:"unknown,not-allowed,unlimited,limited"`
	CorrectionLimit      *int64     `json:"correctionLimit,omitempty" minimum:"0"`
	TextAnswerAllowed    *bool      `json:"textAnswerAllowed,omitempty"`
	FileAnswerAllowed    *bool      `json:"fileAnswerAllowed,omitempty"`
	MaxTotalFileBytes    *int64     `json:"maxTotalFileBytes,omitempty" minimum:"0"`
	RetrievedAt          *time.Time `json:"retrievedAt,omitempty"`
}

type Snapshot struct {
	AcademicYear int
	Courses      []Course         `json:"courses"`
	Materials    *CourseMaterials `json:"courseMaterials,omitempty"`
	MaterialID   string           `json:"lmsMaterialId,omitempty"`
	// nil Resources means the list was not retrieved; an empty slice means a retrieved empty list.
	Resources []RetrievedResource `json:"resources,omitempty"`
	Report    *ReportDetail       `json:"report,omitempty"`
}

type CourseFailure struct {
	CourseID string `json:"lmsCourseId"`
	Error    Error  `json:"error"`
}
type MaterialsResult struct {
	CourseMaterials []CourseMaterials `json:"courseMaterials"`
	Failures        []CourseFailure   `json:"failures"`
}
type Assignment struct {
	CourseID   string   `json:"lmsCourseId"`
	FolderName string   `json:"folderName"`
	Material   Material `json:"material"`
}
type AssignmentsResult struct {
	Assignments []Assignment    `json:"assignments"`
	Failures    []CourseFailure `json:"failures"`
}

type RegistrationResult struct {
	Registered bool `json:"registered"`
}
type DownloadResult struct {
	Type string     `json:"type" enum:"file,external"`
	File *SavedFile `json:"file,omitempty"`
	URL  string     `json:"url,omitempty" format:"uri" pattern:"^https?://"`
}
