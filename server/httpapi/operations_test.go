package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strconv"
	"strings"
	"testing"

	"github.com/danielgtaylor/huma/v2"
	"github.com/futsuuu/ku-potato/server/core/inport"
	"github.com/futsuuu/ku-potato/server/domain"
)

type operationService struct {
	inport.Service
	sync      string
	courseIDs []string
	submitted []domain.Request
}

func (s *operationService) Courses(ctx context.Context, policy string, p inport.Progress) ([]domain.Course, error) {
	s.sync = policy
	if policy == "true" {
		if err := p(domain.OperationStatus{Status: "running", Attempt: 1, Progress: &domain.Progress{Stage: "fetching-courses"}}); err != nil {
			return nil, err
		}
	}
	return []domain.Course{}, nil
}
func (s *operationService) Materials(ctx context.Context, id, policy string, p inport.Progress) (domain.CourseMaterials, error) {
	s.sync = policy
	return domain.CourseMaterials{CourseID: id, Folders: []domain.Folder{}}, nil
}
func (s *operationService) Assignments(ctx context.Context, ids []string, policy string, p inport.Progress) (domain.AssignmentsResult, error) {
	s.sync, s.courseIDs = policy, ids
	return domain.AssignmentsResult{Assignments: []domain.Assignment{}, Failures: []domain.CourseFailure{}}, nil
}
func (s *operationService) Detail(ctx context.Context, id, policy string, p inport.Progress) (domain.Detail, error) {
	s.sync = policy
	return domain.Detail{Material: domain.Material{ID: id}, Resources: []domain.Resource{}}, nil
}
func (s *operationService) Login(ctx context.Context, interactive bool, p inport.Progress) (domain.AuthState, error) {
	s.submitted = append(s.submitted, domain.Request{Kind: "login", Interactive: interactive})
	return domain.AuthState{Status: "authenticated"}, nil
}
func (s *operationService) Register(ctx context.Context, interactive bool, p inport.Progress) (domain.RegistrationResult, error) {
	s.submitted = append(s.submitted, domain.Request{Kind: "register-webauthn", Interactive: interactive})
	return domain.RegistrationResult{Registered: true}, nil
}

func apiRequest(handler http.Handler, method, path, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, "http://127.0.0.1:8787"+path, strings.NewReader(body))
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)
	return res
}

func TestHumaInputsAndQueryResponses(t *testing.T) {
	service := &operationService{}
	handler := New(service, "127.0.0.1:8787")
	for _, path := range []string{"/courses", "/courses/KOG1/materials", "/assignments", "/materials/SRY1"} {
		res := apiRequest(handler, http.MethodGet, path, "")
		if res.Code != 200 || service.sync != "auto" || !strings.Contains(res.Body.String(), `"data":`) {
			t.Fatalf("%s: %d %s, sync=%q", path, res.Code, res.Body, service.sync)
		}
		if strings.Contains(res.Body.String(), `"$schema"`) || res.Header().Get("Location") != "" {
			t.Fatal("unexpected response envelope or Location", res.Body, res.Header())
		}
	}
	res := apiRequest(handler, http.MethodGet, "/assignments?courseId=KOG1&courseId=KOG2&sync=false", "")
	if res.Code != 200 || service.sync != "false" || !reflect.DeepEqual(service.courseIDs, []string{"KOG1", "KOG2"}) {
		t.Fatal("repeated course IDs were not parsed", res.Code, service.courseIDs, service.sync)
	}
	res = apiRequest(handler, http.MethodGet, "/courses?sync=true", "")
	if res.Code != 200 || res.Header().Get("Content-Type") != "text/event-stream" || res.Header().Get("Location") != "" || !strings.Contains(res.Body.String(), "event: status") || !strings.Contains(res.Body.String(), "event: result") {
		t.Fatal(res.Code, res.Header(), res.Body)
	}
	for _, check := range []struct{ path, kind string }{{"/auth/login", "login"}, {"/auth/webauthn", "register-webauthn"}} {
		res = apiRequest(handler, http.MethodPost, check.path, `{"interactive":true}`)
		request := service.submitted[len(service.submitted)-1]
		if res.Code != 200 || res.Header().Get("Location") != "" || request.Kind != check.kind || !request.Interactive {
			t.Fatal(res.Code, request, res.Body)
		}
	}
	if res = apiRequest(handler, http.MethodGet, "/v1/courses", ""); res.Code != 404 {
		t.Fatal("versioned endpoint still available", res.Code)
	}
}

func TestHumaValidationRejectsInvalidRequestsBeforeSubmission(t *testing.T) {
	service := &operationService{}
	handler := New(service, "127.0.0.1:8787")
	for _, check := range []struct {
		method, path, body string
		status             int
	}{
		{"POST", "/auth/login", `{"interactive":"true"}`, 422},
		{"POST", "/auth/login", `{"password":"unused"}`, 422},
		{"POST", "/auth/login", `null`, 422},
		{"POST", "/auth/login", `[]`, 422},
		{"POST", "/auth/login", `{"interactive":`, 400},
		{"POST", "/auth/login", `{} {}`, 400},
		{"POST", "/auth/login", "", 400},
		{"POST", "/auth/login", `{"padding":"` + strings.Repeat("x", 64<<10) + `"}`, 413},
		{"GET", "/courses?sync=invalid", "", 422},
		{"GET", "/assignments?courseId=&courseId=KOG2", "", 422},
	} {
		t.Run(check.path+"/"+strconv.Itoa(check.status)+"/"+check.body[:min(len(check.body), 25)], func(t *testing.T) {
			res := apiRequest(handler, check.method, check.path, check.body)
			var problem huma.ErrorModel
			if err := json.Unmarshal(res.Body.Bytes(), &problem); err != nil {
				t.Fatal(err)
			}
			if res.Code != check.status || problem.Status != check.status || res.Header().Get("Content-Type") != "application/problem+json" {
				t.Fatal(res.Code, res.Header(), res.Body)
			}
		})
	}
	if len(service.submitted) != 0 {
		t.Fatal("invalid requests reached the application", service.submitted)
	}
}

// JSON Schema allows type to be either a string or an array of strings.
type schemaDoc struct {
	Type                 any                   `json:"type"`
	Ref                  string                `json:"$ref"`
	Properties           map[string]*schemaDoc `json:"properties"`
	Items                *schemaDoc            `json:"items"`
	Default              any                   `json:"default"`
	Enum                 []any                 `json:"enum"`
	AdditionalProperties any                   `json:"additionalProperties"`
	OneOf                []*schemaDoc          `json:"oneOf"`
	Const                any                   `json:"const"`
	Pattern              string                `json:"pattern"`
	Minimum              *float64              `json:"minimum"`
}

func (s *schemaDoc) hasType(name string) bool {
	if s.Type == name {
		return true
	}
	if types, ok := s.Type.([]any); ok {
		for _, item := range types {
			if item == name {
				return true
			}
		}
	}
	return false
}

type responseDoc struct {
	Headers map[string]json.RawMessage `json:"headers"`
	Content map[string]*struct {
		Schema *schemaDoc `json:"schema"`
	} `json:"content"`
}

type operationDoc struct {
	Parameters []struct {
		Name    string     `json:"name"`
		Explode *bool      `json:"explode"`
		Schema  *schemaDoc `json:"schema"`
	} `json:"parameters"`
	Responses   map[string]*responseDoc `json:"responses"`
	RequestBody *struct {
		Required bool `json:"required"`
		Content  map[string]*struct {
			Schema *schemaDoc `json:"schema"`
		} `json:"content"`
	} `json:"requestBody"`
}

func TestGeneratedOpenAPIAndDocs(t *testing.T) {
	handler := New(&operationService{}, "127.0.0.1:8787")
	res := apiRequest(handler, http.MethodGet, "/openapi.json", "")
	var spec struct {
		OpenAPI    string
		Paths      map[string]*struct{ Get, Post, Head *operationDoc }
		Components struct{ Schemas map[string]*schemaDoc }
	}
	if err := json.Unmarshal(res.Body.Bytes(), &spec); err != nil {
		t.Fatal(err)
	}
	if res.Code != 200 || spec.OpenAPI != "3.1.0" {
		t.Fatal(res.Code, res.Body)
	}
	for _, path := range []string{"/healthz", "/auth", "/auth/login", "/auth/webauthn", "/auth/check", "/courses", "/courses/{courseId}/materials", "/assignments", "/materials/{materialId}", "/materials/{materialId}/resources/{resourceId}/download", "/materials/{materialId}/resources/{resourceId}/file"} {
		if spec.Paths[path] == nil {
			t.Fatal("missing generated endpoint", path)
		}
	}
	for path := range spec.Paths {
		if strings.HasPrefix(path, "/v1/") {
			t.Fatal("versioned generated endpoint", path)
		}
	}
	resolve := func(schema *schemaDoc) *schemaDoc {
		if schema.Ref != "" {
			return spec.Components.Schemas[strings.TrimPrefix(schema.Ref, "#/components/schemas/")]
		}
		return schema
	}
	courses := spec.Paths["/courses"].Get
	stream := courses.Responses["200"].Content["text/event-stream"].Schema
	if courses.Responses["202"] != nil || spec.Paths["/jobs/{jobId}"] != nil || len(stream.Items.OneOf) != 3 {
		t.Fatal("incorrect stream schema", courses.Responses, stream)
	}
	var data *schemaDoc
	for _, event := range stream.Items.OneOf {
		if event.Properties["event"].Const == "result" {
			data = resolve(event.Properties["data"]).Properties["data"]
		}
	}
	if data == nil || !data.hasType("array") || !strings.HasSuffix(data.Items.Ref, "/Course") {
		t.Fatal("missing typed result", data)
	}
	for name, field := range map[string]string{"Course": "availability", "Material": "type", "Resource": "type", "AuthState": "status", "OperationStatus": "status", "Progress": "stage", "Error": "reason"} {
		if len(spec.Components.Schemas[name].Properties[field].Enum) == 0 {
			t.Fatal("missing enum", name, field)
		}
	}
	download := spec.Paths["/materials/{materialId}/resources/{resourceId}/download"].Post.Responses["200"].Content["text/event-stream"].Schema
	for _, event := range download.Items.OneOf {
		if event.Properties["event"].Const == "result" {
			union := resolve(resolve(event.Properties["data"]).Properties["data"])
			if len(union.OneOf) != 2 {
				t.Fatal("download is not a union", union)
			}
			for _, variant := range union.OneOf {
				if len(resolve(variant).Properties["type"].Enum) != 1 {
					t.Fatal("missing download discriminator", variant)
				}
			}
		}
	}
	sync := courses.Parameters[0]
	if sync.Name != "sync" || sync.Schema.Default != "auto" || !reflect.DeepEqual(sync.Schema.Enum, []any{"auto", "true", "false"}) {
		t.Fatal("missing sync validation schema", sync)
	}
	var repeated bool
	for _, parameter := range spec.Paths["/assignments"].Get.Parameters {
		if parameter.Name == "courseId" {
			repeated = parameter.Explode != nil && *parameter.Explode && parameter.Schema.hasType("array")
		}
	}
	if !repeated {
		t.Fatal("missing repeated course ID schema")
	}
	auth := spec.Paths["/auth/login"].Post.RequestBody
	if !auth.Required || resolve(auth.Content["application/json"].Schema).AdditionalProperties != false {
		t.Fatal("auth body is not a strict required object", auth)
	}
	file := spec.Paths["/materials/{materialId}/resources/{resourceId}/file"]
	if file.Head == nil || file.Get.Responses["206"] == nil || file.Get.Responses["304"] == nil || file.Get.Responses["200"].Content["application/octet-stream"] == nil {
		t.Fatal("missing file transfer schema", file)
	}
	for _, path := range []string{"/openapi.yaml", "/docs"} {
		if res := apiRequest(handler, http.MethodGet, path, ""); res.Code != 200 || res.Body.Len() == 0 {
			t.Fatal(path, res.Code, res.Body)
		}
	}
	req := httptest.NewRequest(http.MethodGet, "http://127.0.0.1:8787/openapi.json", nil)
	req.Header.Set("Origin", "https://example.com")
	res = httptest.NewRecorder()
	handler.ServeHTTP(res, req)
	if res.Code != 403 {
		t.Fatal("schema endpoint bypassed local access checks", res.Code)
	}
}
