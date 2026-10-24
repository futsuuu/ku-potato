package core

import (
	"context"
	"regexp"

	"github.com/futsuuu/ku-potato/server/core/operation"
	"github.com/futsuuu/ku-potato/server/domain"
)

var materialID = regexp.MustCompile(`^[A-Z]+\d+$`)
var resourceID = regexp.MustCompile(`^SRS\d+$`)

func (a *Application) submit(ctx context.Context, r operation.Request) (operation.Job, error) {
	if err := validateJobRequest(r); err != nil {
		return operation.Job{}, err
	}
	seen := map[string]bool{}
	ids := []string{}
	for _, id := range r.CourseIDs {
		if !seen[id] {
			seen[id] = true
			ids = append(ids, id)
		}
	}
	r.CourseIDs = ids
	return a.queue.Enqueue(ctx, r)
}

func validateJobRequest(r operation.Request) error {
	for _, id := range r.CourseIDs {
		if len(id) == 0 || len(id) > 200 {
			return domain.Fail("invalid-input", "invalid course ID")
		}
	}
	if len(r.CourseIDs) > 500 {
		return domain.Fail("invalid-input", "too many courses")
	}
	switch r.Kind {
	case "login", "auth-check", "register-webauthn", "delete-webauthn", "google-login", "google-auth-check", "sync-courses", "sync-materials":
	case "sync-resources", "download-resource":
		if !materialID.MatchString(r.MaterialID) {
			return domain.Fail("invalid-input", "invalid material ID")
		}
	default:
		return domain.Fail("invalid-input", "unknown job kind")
	}
	if r.Kind == "download-resource" && !resourceID.MatchString(r.ResourceID) {
		return domain.Fail("invalid-input", "invalid resource ID")
	}
	if r.Interactive && r.Kind != "login" && r.Kind != "google-login" && r.Kind != "register-webauthn" {
		return domain.Fail("invalid-input", "interaction is only available for authentication jobs")
	}
	if len(r.CourseIDs) > 0 && r.Kind != "sync-materials" {
		return domain.Fail("invalid-input", "courseIds is only available for sync-materials")
	}
	if r.MaterialID != "" && r.Kind != "sync-resources" && r.Kind != "download-resource" {
		return domain.Fail("invalid-input", "materialId is not valid for this job")
	}
	if r.ResourceID != "" && r.Kind != "download-resource" {
		return domain.Fail("invalid-input", "resourceId is only available for download-resource")
	}
	return nil
}
