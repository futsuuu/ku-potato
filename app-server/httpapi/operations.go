package httpapi

import (
	"context"
	"net/http"
	"reflect"
	"strconv"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humago"
	"github.com/futsuuu/ku-potato/app-server/application/authentication"
	"github.com/futsuuu/ku-potato/app-server/application/inport"
	"github.com/futsuuu/ku-potato/app-server/domain"
)

type QueryInput struct {
	Sync string `query:"sync" default:"auto" enum:"auto,true,false" doc:"auto reads saved data or starts synchronization; false reads only; true starts synchronization."`
}

type CourseInput struct {
	QueryInput
	CourseID string `path:"courseId"`
}

type AssignmentsInput struct {
	QueryInput
	CourseIDs []string `query:"courseId,explode" doc:"Repeat to select courses; omission selects all saved courses."`
}

type MaterialInput struct {
	MaterialID string `path:"materialId"`
}

type DetailInput struct {
	QueryInput
	MaterialInput
}

type ResourceInput struct {
	MaterialInput
	ResourceID string `path:"resourceId"`
}

type FileInput struct {
	ResourceInput
	Range       string `header:"Range" doc:"Byte range to retrieve."`
	IfNoneMatch string `header:"If-None-Match" doc:"Return 304 if the saved file's ETag matches."`
	IfRange     string `header:"If-Range" doc:"Apply Range only if the saved file's ETag matches."`
}

type AuthInput struct {
	Body struct {
		Interactive bool `json:"interactive,omitempty" default:"false" doc:"Allow manual authentication in a visible browser on the server machine."`
	}
}

type dataBody[T any] struct {
	Data T `json:"data"`
}
type dataResponse[T any] struct{ Body dataBody[T] }

type resourcePath struct {
	Path string `json:"path"`
}

type healthResponse struct {
	Body struct {
		Status  string `json:"status" enum:"ok"`
		Service string `json:"service" enum:"ku-potato-server"`
	}
}

func (h *Handler) register(api huma.API) {
	register(api, huma.Operation{OperationID: "health", Method: http.MethodGet, Path: "/healthz", Summary: "Check HTTP process"}, func(ctx context.Context, input *struct{}) (*healthResponse, error) {
		output := &healthResponse{}
		output.Body.Status = "ok"
		output.Body.Service = "ku-potato-server"
		return output, nil
	})
	register(api, huma.Operation{OperationID: "getCachedAuthenticationState", Method: http.MethodGet, Path: "/auth", Summary: "Read cached authentication state"}, func(ctx context.Context, input *struct{}) (*dataResponse[authentication.AuthState], error) {
		state, err := h.service.CachedLMSAuthentication(ctx)
		return &dataResponse[authentication.AuthState]{Body: dataBody[authentication.AuthState]{Data: state}}, failure(err)
	})

	registerStream(api, huma.Operation{OperationID: "login", Method: http.MethodPost, Path: "/auth/login", Summary: "Log in to LMS"}, func(ctx context.Context, input *AuthInput, p inport.StatusObserver) (authentication.AuthState, error) {
		return h.service.Login(ctx, input.Body.Interactive, p)
	})
	registerStream(api, huma.Operation{OperationID: "registerWebAuthn", Method: http.MethodPost, Path: "/auth/webauthn", Summary: "Register virtual WebAuthn credential"}, func(ctx context.Context, input *AuthInput, p inport.StatusObserver) (domain.RegistrationResult, error) {
		return h.service.RegisterWebAuthn(ctx, input.Body.Interactive, p)
	})
	register(api, huma.Operation{OperationID: "getWebAuthn", Method: http.MethodGet, Path: "/auth/webauthn", Summary: "Read saved WebAuthn credential state"}, func(ctx context.Context, input *struct{}) (*dataResponse[domain.RegistrationResult], error) {
		state, err := h.service.WebAuthnRegistrationStatus(ctx)
		return &dataResponse[domain.RegistrationResult]{Body: dataBody[domain.RegistrationResult]{Data: state}}, failure(err)
	})
	registerStream(api, huma.Operation{OperationID: "deleteWebAuthn", Method: http.MethodDelete, Path: "/auth/webauthn", Summary: "Delete saved WebAuthn credential"}, func(ctx context.Context, input *struct{}, p inport.StatusObserver) (domain.RegistrationResult, error) {
		return h.service.DeleteWebAuthn(ctx, p)
	})
	registerStream(api, huma.Operation{OperationID: "checkAuthentication", Method: http.MethodPost, Path: "/auth/check", Summary: "Check LMS authentication"}, func(ctx context.Context, input *struct{}, p inport.StatusObserver) (authentication.AuthState, error) {
		return h.service.CheckLMSAuthentication(ctx, p)
	})
	h.registerGoogle(api)
	registerStream(api, huma.Operation{OperationID: "listCourses", Method: http.MethodGet, Path: "/courses", Summary: "Read or synchronize courses"}, func(ctx context.Context, input *QueryInput, p inport.StatusObserver) ([]domain.Course, error) {
		return h.service.Courses(ctx, input.Sync, p)
	})
	registerStream(api, huma.Operation{OperationID: "listMaterials", Method: http.MethodGet, Path: "/courses/{courseId}/materials", Summary: "Read or synchronize course materials"}, func(ctx context.Context, input *CourseInput, p inport.StatusObserver) (domain.CourseMaterials, error) {
		return h.service.Materials(ctx, input.CourseID, input.Sync, p)
	})
	registerStream(api, huma.Operation{OperationID: "listAssignments", Method: http.MethodGet, Path: "/assignments", Summary: "Read or synchronize assignments"}, func(ctx context.Context, input *AssignmentsInput, p inport.StatusObserver) (domain.AssignmentsResult, error) {
		return h.service.Assignments(ctx, input.CourseIDs, input.Sync, p)
	})
	registerStream(api, huma.Operation{OperationID: "getMaterial", Method: http.MethodGet, Path: "/materials/{materialId}", Summary: "Read or synchronize material details"}, func(ctx context.Context, input *DetailInput, p inport.StatusObserver) (domain.Detail, error) {
		return h.service.Detail(ctx, input.MaterialID, input.Sync, p)
	})
	registerStream(api, huma.Operation{OperationID: "downloadResource", Method: http.MethodPost, Path: "/materials/{materialId}/resources/{resourceId}/download", Summary: "Acquire and save a resource"}, func(ctx context.Context, input *ResourceInput, p inport.StatusObserver) (downloadResult, error) {
		result, err := h.service.Download(ctx, input.MaterialID, input.ResourceID, p)
		if err != nil {
			return downloadResult{}, err
		}
		output := downloadResult{Type: result.Type, File: result.File, URL: result.URL}
		if result.Type == "file" {
			output.DownloadURL = "/materials/" + input.MaterialID + "/resources/" + input.ResourceID + "/file"
		}
		return output, nil
	})
	register(api, huma.Operation{OperationID: "prepareResource", Method: http.MethodPost, Path: "/materials/{materialId}/resources/{resourceId}/prepare", Summary: "Materialize a saved resource for local clients"}, func(ctx context.Context, input *ResourceInput) (*dataResponse[resourcePath], error) {
		path, err := h.service.PrepareResource(ctx, input.MaterialID, input.ResourceID)
		return &dataResponse[resourcePath]{Body: dataBody[resourcePath]{Data: resourcePath{Path: path}}}, failure(err)
	})
	for _, method := range []string{http.MethodGet, http.MethodHead} {
		id := "getSavedFile"
		if method == http.MethodHead {
			id = "headSavedFile"
		}
		register(api, huma.Operation{OperationID: id, Method: method, Path: "/materials/{materialId}/resources/{resourceId}/file", Summary: "Serve a saved file", Responses: fileResponses()}, func(ctx context.Context, input *FileInput) (*huma.StreamResponse, error) {
			return h.file(ctx, &input.ResourceInput)
		})
	}
}

func register[I, O any](api huma.API, op huma.Operation, handler func(context.Context, *I) (*O, error)) {
	operationErrors(api, &op)
	huma.Register(api, op, handler)
}

func operationErrors(api huma.API, op *huma.Operation) {
	validationErrors(api, op)
	for _, status := range []int{400, 403, 404, 409, 500} {
		key := strconv.Itoa(status)
		response := jsonResponse[errorBody](api, http.StatusText(status))
		if existing := op.Responses[key]; existing != nil {
			for kind, media := range existing.Content {
				response.Content[kind] = media
			}
		}
		op.Responses[key] = response
	}
}
func validationErrors(api huma.API, op *huma.Operation) {
	op.MaxBodyBytes = 64 << 10
	if op.Responses == nil {
		op.Responses = map[string]*huma.Response{}
	}
	for _, status := range []int{400, 408, 413, 415, 422} {
		key := strconv.Itoa(status)
		if op.Responses[key] == nil {
			op.Responses[key] = &huma.Response{Description: http.StatusText(status), Content: map[string]*huma.MediaType{}}
		}
		op.Responses[key].Content["application/problem+json"] = &huma.MediaType{Schema: api.OpenAPI().Components.Schemas.Schema(reflect.TypeFor[huma.ErrorModel](), true, "")}
	}
}

func jsonResponse[T any](api huma.API, description string) *huma.Response {
	return &huma.Response{Description: description, Content: map[string]*huma.MediaType{
		"application/json": {Schema: api.OpenAPI().Components.Schemas.Schema(reflect.TypeFor[T](), true, "")},
	}}
}

func fileResponses() map[string]*huma.Response {
	responses := map[string]*huma.Response{}
	for _, status := range []int{200, 206} {
		responses[strconv.Itoa(status)] = &huma.Response{
			Description: http.StatusText(status),
			Content:     map[string]*huma.MediaType{"application/octet-stream": {Schema: &huma.Schema{Type: "string", Format: "binary"}}},
			Headers: map[string]*huma.Header{
				"ETag":                {Schema: &huma.Schema{Type: "string"}},
				"Content-Disposition": {Schema: &huma.Schema{Type: "string"}},
				"Accept-Ranges":       {Schema: &huma.Schema{Type: "string"}},
				"Content-Range":       {Schema: &huma.Schema{Type: "string"}},
			},
		}
	}
	responses["304"] = &huma.Response{Description: "ETag matched"}
	responses["416"] = &huma.Response{Description: "Invalid byte range", Content: map[string]*huma.MediaType{"text/plain": {Schema: &huma.Schema{Type: "string"}}}}
	return responses
}

// Huma treats an empty first query value as omission. Reject explicit empty
// selectors so they cannot accidentally turn into synchronization of all courses.
func (input *AssignmentsInput) Resolve(ctx huma.Context) []error {
	r, _ := humago.Unwrap(ctx)
	for _, id := range r.URL.Query()["courseId"] {
		if id == "" {
			return []error{&huma.ErrorDetail{Message: "courseId must not be empty", Location: "query.courseId"}}
		}
	}
	return nil
}
