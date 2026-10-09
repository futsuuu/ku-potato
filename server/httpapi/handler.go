// Package httpapi exposes application features exclusively through inbound ports.
package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"mime"
	"net"
	"net/http"
	"net/url"
	"path"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humago"
	"github.com/futsuuu/ku-potato/server/core/inport"
	"github.com/futsuuu/ku-potato/server/domain"
)

type Handler struct {
	service   inport.Service
	authority string
	mux       *http.ServeMux
}

func New(service inport.Service, authority string) *Handler {
	h := &Handler{service: service, authority: authority, mux: http.NewServeMux()}
	config := huma.DefaultConfig("KU-POTATO HTTP API", "0.0.0")
	// Keep response envelopes free of schema links and generated $schema fields.
	config.CreateHooks = nil
	config.SchemasPath = ""
	config.Info.Description = "Single-account loopback API. Feature endpoints stream typed results, operation status, and progress using SSE. Replay the feature request to retry."
	h.register(humago.New(h.mux, config))
	h.mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		write(w, 404, map[string]any{"error": domain.Error{Reason: "not-found", Message: "API endpoint not found"}})
	})
	return h
}
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", "no-store")
	if !sameAuthority(r.Host, h.authority) || r.Header.Get("Sec-Fetch-Site") == "cross-site" {
		write(w, 403, map[string]any{"error": domain.Error{Reason: "forbidden", Message: "Only local clients are accepted"}})
		return
	}
	if origin := r.Header.Get("Origin"); origin != "" {
		parsed, err := url.Parse(origin)
		if err != nil || parsed.Scheme != "http" || parsed.Host != r.Host || parsed.Path != "" {
			write(w, 403, map[string]any{"error": domain.Error{Reason: "forbidden", Message: "Cross-origin requests are not accepted"}})
			return
		}
	}
	h.mux.ServeHTTP(w, r)
}
func sameAuthority(actual, expected string) bool {
	host, port, err := net.SplitHostPort(actual)
	if err != nil {
		return false
	}
	_, expectedPort, err := net.SplitHostPort(expected)
	if err != nil || port != expectedPort {
		return false
	}
	if host == "localhost" {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

type errorBody struct {
	Failure domain.Error `json:"error"`
}

type responseError struct {
	errorBody
	status int
}

func (e *responseError) Error() string  { return e.Failure.Message }
func (e *responseError) GetStatus() int { return e.status }

func failure(err error) error {
	if err == nil {
		return nil
	}
	status := 500
	failure := domain.Error{Reason: "internal", Message: "処理に失敗しました。サーバログを確認してください。"}
	if errors.Is(err, domain.ErrMissing) {
		status = 404
		failure = domain.Error{Reason: "archive-data-missing", Message: "保存済みデータがありません。"}
	}
	var e *domain.Error
	if errors.As(err, &e) {
		failure = *e
		switch e.Reason {
		case "invalid-input":
			status = 400
		case "conflict":
			status = 409
		case "authentication-required":
			status = 409
		case "material-not-found", "resource-not-found", "course-not-found":
			status = 404
		}
	}
	if status == 500 {
		slog.Error("HTTP operation failed", "error", err)
	}
	return &responseError{errorBody: errorBody{Failure: failure}, status: status}
}
func write(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
func (h *Handler) file(ctx context.Context, input *ResourceInput) (*huma.StreamResponse, error) {
	file, err := h.service.File(ctx, input.MaterialID, input.ResourceID)
	if err != nil {
		return nil, failure(err)
	}
	filename := path.Base(strings.ReplaceAll(file.Metadata.OriginalFilename, "\\", "/"))
	filename = strings.Map(func(c rune) rune {
		if c < 32 || c == 127 {
			return '_'
		}
		return c
	}, filename)
	if filename == "" || filename == "." {
		filename = "resource"
	}
	return &huma.StreamResponse{Body: func(ctx huma.Context) {
		defer file.Content.Close()
		r, w := humago.Unwrap(ctx)
		w.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": filename}))
		w.Header().Set("Content-Type", "application/octet-stream")
		w.Header().Set("ETag", `"`+file.Metadata.SHA256+`"`)
		http.ServeContent(w, r, filename, time.Time{}, file.Content)
	}}, nil
}
