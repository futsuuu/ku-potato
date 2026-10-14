package chromedp

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/futsuuu/ku-potato/server/core/outport"
	"github.com/futsuuu/ku-potato/server/domain"
)

type driveTransport func(*http.Request) (*http.Response, error)

func (f driveTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func driveFixture(t *testing.T, handler http.HandlerFunc) *driveHTTP {
	t.Helper()
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)
	origin, _ := url.Parse(server.URL)
	jar, _ := cookiejar.New(nil)
	google, _ := url.Parse("https://drive.google.com")
	jar.SetCookies(google, []*http.Cookie{{Name: "session", Value: "fixture", Domain: ".google.com", Path: "/", Secure: true}})
	transport := http.DefaultTransport.(*http.Transport).Clone()
	t.Cleanup(transport.CloseIdleConnections)
	return &driveHTTP{client: &http.Client{Jar: jar, CheckRedirect: driveRedirect, Transport: driveTransport(func(r *http.Request) (*http.Response, error) {
		if !driveEndpoint(r.URL) {
			t.Errorf("unexpected request: %s", r.URL.Host)
		}
		copy := r.Clone(r.Context())
		copy.URL.Scheme, copy.URL.Host = origin.Scheme, origin.Host
		return transport.RoundTrip(copy)
	})}}
}

func TestDriveURLs(t *testing.T) {
	for _, raw := range []string{
		"https://drive.google.com/file/d/file_1-2/view?usp=sharing&resourcekey=key",
		"https://drive.google.com/open?id=file_1-2&resourcekey=key",
		"https://drive.google.com/uc?export=download&id=file_1-2&resourcekey=key",
		"https://docs.google.com/presentation/d/file_1-2/edit?resourcekey=key",
		"https://docs.google.com/document/u/0/d/file_1-2/edit?resourcekey=key",
		"https://docs.google.com/spreadsheets/d/file_1-2/edit?resourcekey=key",
		"https://colab.research.google.com/drive/file_1-2?resourcekey=key",
	} {
		t.Run(raw, func(t *testing.T) {
			got, ok := driveDownloadURL(raw)
			if !ok || got.Host != "drive.google.com" || got.Query().Get("id") != "file_1-2" || got.Query().Get("resourcekey") != "key" || got.Query().Get("authuser") != "0" {
				t.Fatal(got, ok)
			}
		})
	}
	for _, raw := range []string{
		"http://drive.google.com/file/d/id/view", "https://drive.google.com.evil.test/file/d/id/view",
		"https://drive.google.com:123/file/d/id/view", "https://user@drive.google.com/file/d/id/view",
		"https://drive.google.com/drive/folders/id", "https://drive.google.com/open?id=../other",
		"https://docs.google.com/presentation/d/e/published/pub", "https://colab.research.google.com/github/user/repo",
		"https://example.org/file.pdf", "https://drive.google.com/file/d//view",
	} {
		if got, ok := driveDownloadURL(raw); ok {
			t.Errorf("accepted unsupported URL %s: %s", raw, got)
		}
	}
}

func TestDriveDownloadAndMetadataFollowConfirmationWithCookies(t *testing.T) {
	content := "%PDF-1.7\n" + strings.Repeat("file bytes", 200)
	var confirmed atomic.Int32
	d := driveFixture(t, func(w http.ResponseWriter, r *http.Request) {
		cookie, err := r.Cookie("session")
		if err != nil || cookie.Value != "fixture" {
			t.Error("Google cookies missing after redirect", err)
		}
		if r.URL.Path == "/uc" {
			http.Redirect(w, r, "https://drive.usercontent.google.com/download?"+r.URL.RawQuery, http.StatusFound)
			return
		}
		if r.URL.Query().Get("confirm") == "" {
			w.Header().Set("Content-Type", "text/html")
			fmt.Fprint(w, `<form id="download-form" action="https://drive.usercontent.google.com/download" method="get"><input type="hidden" name="id" value="file"><input type="hidden" name="export" value="download"><input type="hidden" name="confirm" value="t"><input type="hidden" name="uuid" value="token&amp;value"></form>`)
			return
		}
		confirmed.Add(1)
		if r.URL.Query().Get("uuid") != "token&value" || r.URL.Query().Get("resourcekey") != "key" {
			t.Error("confirmation token or resource key was lost")
		}
		w.Header().Set("Content-Disposition", `attachment; filename*=UTF-8''%E8%B3%87%E6%96%99.pdf`)
		w.Header().Set("Content-Type", "application/octet-stream")
		if r.Header.Get("Accept-Encoding") != "identity" {
			t.Error("compressed response would invalidate the byte count")
		}
		if r.Header.Get("Range") != "" {
			if r.Header.Get("Range") != "bytes=0-511" {
				t.Error("metadata did not request a bounded sample")
			}
			w.Header().Set("Content-Range", "bytes 0-511/5000000000")
			w.WriteHeader(http.StatusPartialContent)
			fmt.Fprint(w, content[:512])
			return
		}
		fmt.Fprint(w, content)
	})
	u, _ := driveDownloadURL("https://drive.google.com/file/d/file/view?resourcekey=key")
	response, metadata, err := d.open(context.Background(), u, true)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if metadata.Filename != "資料.pdf" || metadata.MIMEType != "application/pdf" || metadata.Size != 5000000000 {
		t.Fatal(metadata)
	}
	dir := t.TempDir()
	file, filename, err := d.download(context.Background(), u, dir)
	if err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(file)
	if err != nil || string(got) != content || filename != "資料.pdf" || filepath.Dir(file) != dir || confirmed.Load() != 2 {
		t.Fatal("download did not preserve content/name", filename, err)
	}
}

func TestDriveRejectsPagesAndUnsafeRedirects(t *testing.T) {
	for _, test := range []struct {
		name, redirect, body, reason string
		status                       int
	}{
		{"login", "https://accounts.google.com/ServiceLogin", "", "authentication-required", 302},
		{"offsite", "https://example.org/download", "", "source", 302},
		{"downgrade", "http://drive.google.com/download", "", "source", 302},
		{"permission", "", "", "forbidden", 403},
		{"missing", "", "", "source", 404},
		{"html", "", "<html>not a file</html>", "unsupported-resource", 200},
		{"unsafe-form", "", `<form id="download-form" action="https://example.org/download"></form>`, "source", 200},
		{"wrong-file", "", `<form id="download-form" action="https://drive.usercontent.google.com/download"><input type="hidden" name="id" value="other"></form>`, "source", 200},
		{"huge-page", "", strings.Repeat("x", (1<<20)+1), "source", 200},
	} {
		t.Run(test.name, func(t *testing.T) {
			d := driveFixture(t, func(w http.ResponseWriter, r *http.Request) {
				if test.redirect != "" {
					http.Redirect(w, r, test.redirect, test.status)
					return
				}
				w.WriteHeader(test.status)
				fmt.Fprint(w, test.body)
			})
			u, _ := driveDownloadURL("https://drive.google.com/open?id=file")
			dir := t.TempDir()
			_, _, err := d.download(context.Background(), u, dir)
			var failure *domain.Error
			if !errors.As(err, &failure) || failure.Reason != test.reason {
				t.Fatal(err)
			}
			files, _ := os.ReadDir(dir)
			if len(files) != 0 {
				t.Fatal("saved an error page")
			}
		})
	}
}

type sampledBody struct {
	read   int
	closed bool
}

func (b *sampledBody) Read(p []byte) (int, error) {
	if b.read >= 2048 {
		return 0, io.EOF
	}
	n := min(len(p), 2048-b.read)
	copy(p, strings.Repeat("x", n))
	b.read += n
	return n, nil
}
func (b *sampledBody) Close() error { b.closed = true; return nil }

func TestDriveMetadataClosesRangeIgnoringServerWithoutReadingFile(t *testing.T) {
	body := &sampledBody{}
	d := &driveHTTP{client: &http.Client{Transport: driveTransport(func(r *http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: 200, ContentLength: 2048, Header: http.Header{
			"Content-Disposition": {`attachment; filename="notebook.ipynb"`},
			"Content-Type":        {"application/octet-stream"},
		}, Body: body, Request: r}, nil
	})}}
	u, _ := driveDownloadURL("https://colab.research.google.com/drive/file")
	response, metadata, err := d.open(context.Background(), u, true)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if metadata.Size != 2048 || metadata.MIMEType != "application/x-ipynb+json" || body.read > 512 || !body.closed {
		t.Fatal(metadata, body)
	}
}

func TestDriveIncompleteDownloadIsRemoved(t *testing.T) {
	d := driveFixture(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Disposition", `attachment; filename="file.pdf"`)
		w.Header().Set("Content-Length", "1000")
		fmt.Fprint(w, "%PDF truncated")
	})
	u, _ := driveDownloadURL("https://drive.google.com/open?id=file")
	dir := t.TempDir()
	file, _, err := d.download(context.Background(), u, dir)
	if err == nil || file != "" {
		t.Fatal("accepted incomplete response", file, err)
	}
	files, _ := os.ReadDir(dir)
	if len(files) != 0 {
		t.Fatal("left partial file", files)
	}
}

func TestDriveInvalidRangeCannotBecomeFileSize(t *testing.T) {
	for _, contentRange := range []string{"", "bytes 1-511/1000", "bytes 0-511/10", "bytes 0-512/1000", "bytes 0-511/999999999999999999999"} {
		t.Run(contentRange, func(t *testing.T) {
			d := driveFixture(t, func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Disposition", `attachment; filename="file.pdf"`)
				w.Header().Set("Content-Range", contentRange)
				w.WriteHeader(http.StatusPartialContent)
				fmt.Fprint(w, strings.Repeat("x", 512))
			})
			u, _ := driveDownloadURL("https://drive.google.com/open?id=file")
			_, _, err := d.open(context.Background(), u, true)
			if err == nil {
				t.Fatal("accepted invalid range")
			}
		})
	}
}

func TestDriveSniffingPreservesDownloadAndUnknownSize(t *testing.T) {
	content := "%PDF-1.7\n" + strings.Repeat("x", 1024)
	d := driveFixture(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Disposition", `attachment; filename="file.unknown"`)
		w.Header().Set("Content-Type", "application/octet-stream")
		if r.Header.Get("Range") != "" {
			w.Header().Set("Content-Range", "bytes 0-511/*")
			w.WriteHeader(http.StatusPartialContent)
			fmt.Fprint(w, content[:512])
			return
		}
		fmt.Fprint(w, content)
	})
	u, _ := driveDownloadURL("https://drive.google.com/open?id=file")
	response, metadata, err := d.open(context.Background(), u, true)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if metadata.Size != -1 || metadata.MIMEType != "application/pdf" {
		t.Fatal(metadata)
	}
	file, _, err := d.download(context.Background(), u, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	body, err := os.ReadFile(file)
	if err != nil || string(body) != content {
		t.Fatal("sniffing consumed file bytes", err)
	}
}

func TestDriveCancelledDownloadIsRemoved(t *testing.T) {
	started := make(chan struct{})
	d := driveFixture(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Disposition", `attachment; filename="file.pdf"`)
		w.Header().Set("Content-Type", "application/pdf")
		w.Header().Set("Content-Length", "1000000")
		fmt.Fprint(w, "%PDF start")
		w.(http.Flusher).Flush()
		close(started)
		<-r.Context().Done()
	})
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	u, _ := driveDownloadURL("https://drive.google.com/open?id=file")
	dir := t.TempDir()
	done := make(chan error, 1)
	go func() { _, _, err := d.download(ctx, u, dir); done <- err }()
	select {
	case <-started:
	case <-ctx.Done():
		t.Fatal("download did not start")
	}
	cancel()
	if err := <-done; !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
	files, _ := os.ReadDir(dir)
	if len(files) != 0 {
		t.Fatal("left cancelled download", files)
	}
}

func TestDrivePublicErrorOmitsConfirmationToken(t *testing.T) {
	err := googleDownloadError(context.Background(), &url.Error{
		Op: "Get", URL: "https://drive.usercontent.google.com/download?at=secret",
		Err: domain.Fail("authentication-required", "Google login required"),
	})
	var provider *outport.AuthenticationError
	var failure *domain.Error
	if strings.Contains(err.Error(), "secret") || !errors.As(err, &provider) || provider.Provider != "google" || !errors.As(err, &failure) || failure.Reason != "authentication-required" {
		t.Fatal("unsafe or unscoped authentication error", err)
	}
}
