package operation

import "github.com/futsuuu/ku-potato/app-server/domain"

type Request struct {
	Kind        string   `json:"kind"`
	CourseIDs   []string `json:"courseIds,omitempty"`
	MaterialID  string   `json:"materialId,omitempty"`
	ResourceID  string   `json:"resourceId,omitempty"`
	Interactive bool     `json:"interactive,omitempty"`
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
	Status   string        `json:"status" enum:"queued,running,retrying,succeeded,failed,blocked"`
	Attempt  int           `json:"attempt" minimum:"0" maximum:"3"`
	Progress *Progress     `json:"progress,omitempty"`
	Error    *domain.Error `json:"error,omitempty"`
}
