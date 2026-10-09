package tests

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/futsuuu/ku-potato/server/core"
	"github.com/futsuuu/ku-potato/server/domain"
	"github.com/futsuuu/ku-potato/server/filesystem"
	"github.com/futsuuu/ku-potato/server/httpapi"
	"github.com/futsuuu/ku-potato/server/memory"
	"github.com/futsuuu/ku-potato/server/sqlite"
)

type source struct {
	authenticated atomic.Bool
	failDownload  atomic.Bool
	courseCalls   atomic.Int32
	failCourses   atomic.Int32
	release       <-chan struct{}
	path          string
}

func (s *source) Login(context.Context, bool) error    { s.authenticated.Store(true); return nil }
func (s *source) Logout(context.Context) error         { s.authenticated.Store(false); return nil }
func (s *source) Register(context.Context, bool) error { return nil }
func (s *source) Status(context.Context) (bool, error) { return s.authenticated.Load(), nil }
func (s *source) check() error {
	if !s.authenticated.Load() {
		return domain.Fail("authentication-required", "login required")
	}
	return nil
}
func (s *source) Courses(ctx context.Context) ([]domain.Course, error) {
	s.courseCalls.Add(1)
	if s.release != nil {
		select {
		case <-s.release:
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}
	if s.failCourses.Add(-1) >= 0 {
		return nil, domain.Fail("source", "transient fixture error")
	}
	return []domain.Course{{ID: "KOG1", Name: "course", Availability: "available"}}, s.check()
}
func (s *source) Materials(ctx context.Context, id string) (domain.Snapshot, error) {
	if id == "KOG2" {
		return domain.Snapshot{}, domain.Fail("course-not-found", "missing course fixture")
	}
	courses, err := s.Courses(ctx)
	return domain.Snapshot{Courses: courses, Materials: &domain.CourseMaterials{CourseID: id, Folders: []domain.Folder{{Name: "week", Materials: []domain.Material{{ID: "SRY1", Type: "material"}, {ID: "REP1", Type: "report"}}}}}}, err
}
func (s *source) Resources(ctx context.Context, id, _ string) (domain.Snapshot, error) {
	snapshot, err := s.Materials(ctx, "KOG1")
	snapshot.MaterialID = id
	snapshot.Resources = []domain.Resource{{ID: "SRS1", Name: "file.txt", Type: "file"}}
	return snapshot, err
}
func (s *source) Download(ctx context.Context, material, resource, preferred string) (domain.Download, error) {
	snapshot, err := s.Resources(ctx, material, preferred)
	if err != nil {
		return domain.Download{}, err
	}
	if s.failDownload.Load() {
		return domain.Download{Snapshot: snapshot}, domain.Fail("unsupported-resource", "failed fixture")
	}
	if err = os.WriteFile(s.path, []byte("saved bytes"), 0600); err != nil {
		return domain.Download{}, err
	}
	return domain.Download{Snapshot: snapshot, Path: s.path, Filename: "file.txt"}, nil
}

func TestHTTPStreamsArchiveAndFileDelivery(t *testing.T) {
	dir := t.TempDir()
	store, err := sqlite.Open(filepath.Join(dir, "archive.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	files, err := filesystem.New(filepath.Join(dir, "files"))
	if err != nil {
		t.Fatal(err)
	}
	fake := &source{path: filepath.Join(dir, "staging")}
	app := core.New(fake, store, store, memory.NewQueue(), files, time.Second, 4)
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- app.Run(ctx) }()
	defer func() {
		cancel()
		if err := <-done; err != nil {
			t.Error(err)
		}
	}()
	handler := httpapi.New(app, "127.0.0.1:8787")
	request := func(method, url, body string) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(method, "http://127.0.0.1:8787"+url, strings.NewReader(body))
		if body != "" {
			req.Header.Set("Content-Type", "application/json")
		}
		res := httptest.NewRecorder()
		handler.ServeHTTP(res, req)
		return res
	}
	wait := func(res *httptest.ResponseRecorder) domain.Job {
		t.Helper()
		if res.Code != 200 || res.Header().Get("Content-Type") != "text/event-stream" || res.Header().Get("Location") != "" {
			t.Fatalf("expected SSE, got %d %s", res.Code, res.Body)
		}
		job := domain.Job{}
		terminal := 0
		for _, frame := range strings.Split(res.Body.String(), "\n\n") {
			var event, data string
			for _, line := range strings.Split(frame, "\n") {
				if strings.HasPrefix(line, "event: ") {
					event = strings.TrimPrefix(line, "event: ")
				}
				if strings.HasPrefix(line, "data: ") {
					data = strings.TrimPrefix(line, "data: ")
				}
			}
			switch event {
			case "status":
				var status domain.OperationStatus
				if err := json.Unmarshal([]byte(data), &status); err != nil {
					t.Fatal(err)
				}
				job.Status, job.Attempts, job.Progress = status.Status, status.Attempt, status.Progress
			case "result":
				var envelope struct{ Data json.RawMessage }
				if err := json.Unmarshal([]byte(data), &envelope); err != nil {
					t.Fatal(err)
				}
				job.Result = envelope.Data
				terminal++
			case "error":
				var envelope struct{ Error *domain.Error }
				if err := json.Unmarshal([]byte(data), &envelope); err != nil {
					t.Fatal(err)
				}
				job.Error = envelope.Error
				terminal++
			}
		}
		if terminal != 1 {
			t.Fatal("missing or multiple terminal events", res.Body)
		}
		return job
	}
	blocked := wait(request("GET", "/courses", ""))
	if blocked.Status != "blocked" {
		t.Fatal(blocked)
	}
	login := wait(request("POST", "/auth/login", `{"interactive":true}`))
	if login.Status != "succeeded" {
		t.Fatal(login)
	}
	checked := wait(request("POST", "/auth/check", ""))
	if checked.Status != "succeeded" || !bytes.Contains(checked.Result, []byte(`"status":"authenticated"`)) {
		t.Fatal(checked)
	}
	registered := wait(request("POST", "/auth/webauthn", `{"interactive":false}`))
	if registered.Status != "succeeded" || !bytes.Contains(registered.Result, []byte(`"registered":true`)) {
		t.Fatal(registered)
	}
	retried := wait(request("GET", "/courses?sync=true", ""))
	if retried.Status != "succeeded" {
		t.Fatal(retried)
	}
	if res := request("GET", "/jobs/missing", ""); res.Code != 404 {
		t.Fatal("job route still available", res.Code)
	}
	if res := request("GET", "/courses?sync=false", ""); res.Code != 200 || !bytes.Contains(res.Body.Bytes(), []byte("KOG1")) {
		t.Fatal(res.Code, res.Body)
	}
	materials := wait(request("GET", "/courses/KOG1/materials", ""))
	if materials.Status != "succeeded" || !bytes.Contains(materials.Result, []byte(`"lmsCourseId":"KOG1"`)) || bytes.Contains(materials.Result, []byte(`"courseMaterials"`)) {
		t.Fatal(materials)
	}
	if res := request("GET", "/assignments?courseId=KOG1&sync=false", ""); res.Code != 200 || !strings.Contains(res.Body.String(), "REP1") {
		t.Fatal(res.Code, res.Body)
	}
	syncedAssignments := wait(request("GET", "/assignments?courseId=KOG1&sync=true", ""))
	if syncedAssignments.Status != "succeeded" || !bytes.Contains(syncedAssignments.Result, []byte(`"assignments"`)) || !bytes.Contains(syncedAssignments.Result, []byte("REP1")) {
		t.Fatal(syncedAssignments)
	}
	resources := wait(request("GET", "/materials/SRY1", ""))
	if resources.Status != "succeeded" {
		t.Fatal(resources)
	}
	download := wait(request("POST", "/materials/SRY1/resources/SRS1/download", ""))
	if download.Status != "succeeded" || bytes.Contains(download.Result, []byte(dir)) {
		t.Fatal(download)
	}
	var downloadResult struct {
		DownloadURL string `json:"downloadUrl"`
	}
	if err := json.Unmarshal(download.Result, &downloadResult); err != nil || downloadResult.DownloadURL != "/materials/SRY1/resources/SRS1/file" {
		t.Fatal("invalid download URL", string(download.Result), err)
	}
	fake.failDownload.Store(true)
	failed := wait(request("POST", "/materials/SRY1/resources/SRS1/download", ""))
	if failed.Status != "failed" {
		t.Fatal(failed)
	}
	res := request("GET", "/materials/SRY1/resources/SRS1/file", "")
	body, _ := io.ReadAll(res.Result().Body)
	if res.Code != 200 || string(body) != "saved bytes" || !strings.Contains(res.Header().Get("Content-Disposition"), "file.txt") {
		t.Fatal(res.Code, string(body))
	}
	fileURL := "http://127.0.0.1:8787" + downloadResult.DownloadURL
	for _, check := range []struct {
		method, header, value string
		status                int
		body                  string
	}{
		{http.MethodHead, "", "", 200, ""},
		{http.MethodGet, "Range", "bytes=0-4", 206, "saved"},
		{http.MethodGet, "Range", "bytes=100-200", 416, "invalid range: failed to overlap\n"},
		{http.MethodGet, "If-None-Match", res.Header().Get("ETag"), 304, ""},
	} {
		req := httptest.NewRequest(check.method, fileURL, nil)
		if check.header != "" {
			req.Header.Set(check.header, check.value)
		}
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, req)
		if response.Code != check.status || response.Body.String() != check.body {
			t.Fatalf("%s %s: %d %q", check.method, check.header, response.Code, response.Body.String())
		}
	}
	partial := wait(request("GET", "/assignments?courseId=KOG1&courseId=KOG2&sync=true", ""))
	var partialResult domain.AssignmentsResult
	if partial.Status != "succeeded" || json.Unmarshal(partial.Result, &partialResult) != nil || len(partialResult.Failures) != 1 || partialResult.Failures[0].CourseID != "KOG2" || partial.Progress.Completed != 2 || partial.Progress.Total != 2 {
		t.Fatal(partial, partialResult)
	}
	missingMaterials := wait(request("GET", "/courses/KOG2/materials?sync=true", ""))
	if missingMaterials.Status != "failed" || missingMaterials.Error == nil || missingMaterials.Error.Reason != "course-not-found" {
		t.Fatal(missingMaterials)
	}
	loggedOut := wait(request("DELETE", "/auth", ""))
	if loggedOut.Status != "succeeded" || !bytes.Contains(loggedOut.Result, []byte(`"status":"unauthenticated"`)) {
		t.Fatal(loggedOut)
	}
	if res = request("POST", "/jobs", `{"kind":"unknown"}`); res.Code != 404 {
		t.Fatal(res.Code)
	}
	if res = request("GET", "/courses?sync=oops", ""); res.Code != 422 {
		t.Fatal(res.Code)
	}
	if res = request("POST", "/auth/login", `{"interactive":true,"password":"not-accepted"}`); res.Code != 422 {
		t.Fatal(res.Code)
	}
	if res = request("POST", "/auth/login", `null`); res.Code != 422 {
		t.Fatal("accepted null object", res.Code)
	}
	if res = request("GET", "/jobs/missing", ""); res.Code != 404 {
		t.Fatal(res.Code)
	}
	for _, headers := range []map[string]string{{"Host": "attacker.example:8787"}, {"Origin": "https://attacker.example"}, {"Sec-Fetch-Site": "cross-site"}} {
		req := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:8787/jobs", strings.NewReader(`{"kind":"logout"}`))
		req.Header.Set("Content-Type", "application/json")
		for key, value := range headers {
			if key == "Host" {
				req.Host = value
			} else {
				req.Header.Set(key, value)
			}
		}
		res := httptest.NewRecorder()
		handler.ServeHTTP(res, req)
		if res.Code != 403 {
			t.Fatal(headers, res.Code)
		}
	}
}
