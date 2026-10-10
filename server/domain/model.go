package domain

import (
	"encoding/json"
	"errors"
	"time"
)

var ErrMissing = errors.New("archive-data-missing")

type Error struct {
	Reason  string `json:"reason" enum:"invalid-input,conflict,authentication-required,archive-data-missing,material-not-found,resource-not-found,course-not-found,unsupported-resource,source,timeout,internal,archive,authentication-storage,resource-storage,not-found,forbidden"`
	Message string `json:"message"`
}

func (e *Error) Error() string          { return e.Message }
func Fail(reason, message string) error { return &Error{reason, message} }

type Course struct {
	ID           string `json:"lmsCourseId,omitempty"`
	Name         string `json:"name"`
	Availability string `json:"availability" enum:"available,unavailable"`
	Archived     bool   `json:"archived,omitempty"`
}
type Material struct {
	ID                   string     `json:"lmsMaterialId"`
	Name                 string     `json:"name"`
	Type                 string     `json:"type" enum:"material,report,test,questionnaire,e-learning"`
	PublicationDeadline  string     `json:"publicationDeadline"`
	ResourceAvailability string     `json:"resourceAvailability,omitempty" enum:"available,unavailable"`
	FetchedAt            *time.Time `json:"fetchedAt,omitempty"`
	Archived             bool       `json:"archived,omitempty"`
}
type Folder struct {
	Name      string     `json:"name"`
	ClassDate string     `json:"classDate,omitempty" format:"date-time"`
	Materials []Material `json:"materials"`
}
type CourseMaterials struct {
	CourseID string   `json:"lmsCourseId"`
	Folders  []Folder `json:"folders"`
}
type SavedFile struct {
	ID               string `json:"id"`
	OriginalFilename string `json:"originalFilename"`
	SHA256           string `json:"sha256" pattern:"^[a-f0-9]{64}$"`
	Size             int64  `json:"size" minimum:"0"`
}
type Attempt struct {
	At     time.Time `json:"at"`
	Status string    `json:"status" enum:"success,failure"`
	Error  string    `json:"error,omitempty"`
}
type Acquisition struct {
	LastSucceededAt *time.Time `json:"lastSucceededAt,omitempty"`
	LastAttempt     Attempt    `json:"lastAttempt"`
}
type Resource struct {
	ID           string       `json:"lmsResourceId"`
	Name         string       `json:"name"`
	Type         string       `json:"type" enum:"file,external,unsupported"`
	SourceKind   string       `json:"sourceKind"`
	URL          string       `json:"url,omitempty" format:"uri" pattern:"^https?://"`
	Availability string       `json:"availability" enum:"current,archived"`
	SavedFile    *SavedFile   `json:"savedFile,omitempty"`
	Acquisition  *Acquisition `json:"acquisition,omitempty"`
}
type Detail struct {
	Course    Course     `json:"course"`
	Material  Material   `json:"material"`
	Resources []Resource `json:"resources"`
}
type Snapshot struct {
	Courses    []Course         `json:"courses"`
	Materials  *CourseMaterials `json:"courseMaterials,omitempty"`
	MaterialID string           `json:"lmsMaterialId,omitempty"`
	// nil Resources means the list was not fetched; an empty slice means a fetched empty list.
	Resources []Resource `json:"resources,omitempty"`
}
type Download struct {
	Snapshot Snapshot
	Path     string
	Filename string
	URL      string
}
type AuthState struct {
	Status    string     `json:"status" enum:"unknown,authenticated,unauthenticated"`
	CheckedAt *time.Time `json:"checkedAt,omitempty"`
}
type Request struct {
	Kind        string   `json:"kind"`
	CourseIDs   []string `json:"courseIds,omitempty"`
	MaterialID  string   `json:"materialId,omitempty"`
	ResourceID  string   `json:"resourceId,omitempty"`
	Interactive bool     `json:"interactive,omitempty"`
}
type Job struct {
	ID        string          `json:"id"`
	Request   Request         `json:"request"`
	Status    string          `json:"status"`
	Attempts  int             `json:"attempts"`
	CreatedAt time.Time       `json:"createdAt"`
	UpdatedAt time.Time       `json:"updatedAt"`
	Result    json.RawMessage `json:"result,omitempty"`
	Error     *Error          `json:"error,omitempty"`
	Progress  *Progress       `json:"progress,omitempty"`
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

// Progress counts completed work units, including individual course failures.
// Total is zero while the size of the work is not yet known.
type Progress struct {
	Stage     string `json:"stage" enum:"waiting,authenticating,logging-out,registering,fetching-courses,fetching-materials,fetching-resources,downloading,saving,completed"`
	Completed int    `json:"completed" minimum:"0"`
	Total     int    `json:"total" minimum:"0"`
	CourseID  string `json:"lmsCourseId,omitempty"`
}
type OperationStatus struct {
	Status   string    `json:"status" enum:"queued,running,retrying,succeeded,failed,blocked"`
	Attempt  int       `json:"attempt" minimum:"0" maximum:"3"`
	Progress *Progress `json:"progress,omitempty"`
	Error    *Error    `json:"error,omitempty"`
}
type RegistrationResult struct {
	Registered bool `json:"registered"`
}
type DownloadResult struct {
	Type        string     `json:"type" enum:"file,external"`
	File        *SavedFile `json:"file,omitempty"`
	DownloadURL string     `json:"downloadUrl,omitempty" pattern:"^/materials/[A-Z]+[0-9]+/resources/SRS[0-9]+/file$"`
	URL         string     `json:"url,omitempty" format:"uri" pattern:"^https?://"`
}
