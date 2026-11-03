package httpapi

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestDesktopCORSIsRestrictedToExactOrigins(t *testing.T) {
	handler := New(nil, "127.0.0.1:8787")
	for _, origin := range []string{
		"http://wails.localhost", "http://wails.localhost:9245", "http://wails.localhost:34115",
		"wails://localhost", "wails://localhost:9245",
		"wails://wails", "wails://wails:34115", "wails://wails.localhost:34115",
	} {
		t.Run(origin, func(t *testing.T) {
			request := httptest.NewRequest("OPTIONS", "http://127.0.0.1:8787/auth/login", nil)
			request.Header.Set("Origin", origin)
			request.Header.Set("Sec-Fetch-Site", "cross-site")
			request.Header.Set("Access-Control-Request-Method", "POST")
			request.Header.Set("Access-Control-Request-Headers", "content-type")
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, request)
			if response.Code != 204 ||
				response.Header().Get("Access-Control-Allow-Origin") != origin {
				t.Fatalf("preflight: %d %s", response.Code, response.Body.String())
			}
			request = httptest.NewRequest("GET", "http://127.0.0.1:8787/healthz", nil)
			request.Header.Set("Origin", origin)
			request.Header.Set("Sec-Fetch-Site", "cross-site")
			response = httptest.NewRecorder()
			handler.ServeHTTP(response, request)
			if response.Code != 200 ||
				response.Header().Get("Access-Control-Allow-Origin") != origin {
				t.Fatalf("request: %d %s", response.Code, response.Body.String())
			}
		})
	}
	for _, origin := range []string{
		"null", "https://example.com", "http://127.0.0.1:5173", "http://127.0.0.1:5174",
		"http://wails.localhost.evil.test", "http://wails.localhost/",
		"wails://localhost.evil.test", "wails://localhost/", "wails://localhost:9246",
		"http://localhost", "http://localhost:9245", "http://wails.localhost:9246",
	} {
		request := httptest.NewRequest("GET", "http://127.0.0.1:8787/healthz", nil)
		request.Header.Set("Origin", origin)
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if response.Code != http.StatusForbidden ||
			response.Header().Get("Access-Control-Allow-Origin") != "" {
			t.Fatalf("untrusted origin %q accepted", origin)
		}
	}
}

func TestDesktopPreflightRejectsUnsupportedMethodsAndHeaders(t *testing.T) {
	for _, input := range []struct{ method, headers string }{{"PUT", "content-type"}, {"POST", "x-untrusted"}} {
		request := httptest.NewRequest("OPTIONS", "http://127.0.0.1:8787/auth", nil)
		request.Header.Set("Origin", "http://wails.localhost")
		request.Header.Set("Access-Control-Request-Method", input.method)
		request.Header.Set("Access-Control-Request-Headers", input.headers)
		response := httptest.NewRecorder()
		New(nil, "127.0.0.1:8787").ServeHTTP(response, request)
		if response.Code != http.StatusForbidden {
			t.Fatalf("unexpected preflight status %d", response.Code)
		}
	}
}
