package tests

import (
	"bufio"
	"context"
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/futsuuu/ku-potato/app-server/application"
	"github.com/futsuuu/ku-potato/app-server/application/operation"
	"github.com/futsuuu/ku-potato/app-server/authstate"
	"github.com/futsuuu/ku-potato/app-server/domain"
	"github.com/futsuuu/ku-potato/app-server/httpapi"
	"github.com/futsuuu/ku-potato/app-server/sqlite"
)

func streamingServer(t *testing.T, source *source) *httptest.Server {
	t.Helper()
	store, err := sqlite.Open(filepath.Join(t.TempDir(), "archive.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	app := application.New(source, store, authstate.NewAuthenticationState(), nil, 5*time.Second, 2)
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- app.Run(ctx) }()
	server := httptest.NewUnstartedServer(nil)
	server.Config.Handler = httpapi.New(app, server.Listener.Addr().String())
	server.Config.BaseContext = func(_ net.Listener) context.Context { return ctx }
	server.Start()
	t.Cleanup(func() {
		cancel()
		server.Close()
		if err := <-done; err != nil {
			t.Error(err)
		}
	})
	return server
}

func readFrame(t *testing.T, scanner *bufio.Scanner) (string, json.RawMessage) {
	t.Helper()
	var event, data string
	for scanner.Scan() {
		line := scanner.Text()
		if line == "" && event != "" {
			return event, json.RawMessage(data)
		}
		if strings.HasPrefix(line, "event: ") {
			event = strings.TrimPrefix(line, "event: ")
		}
		if strings.HasPrefix(line, "data: ") {
			data = strings.TrimPrefix(line, "data: ")
		}
	}
	t.Fatal("stream ended before event", scanner.Err())
	return "", nil
}

func TestStatusFlushesBeforeCompletionAndDisconnectDoesNotCancelSharedWork(t *testing.T) {
	release := make(chan struct{})
	fake := &source{release: release}
	fake.authenticated.Store(true)
	server := streamingServer(t, fake)
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()
	firstCtx, detach := context.WithCancel(ctx)
	defer detach()
	request, _ := http.NewRequestWithContext(
		firstCtx,
		http.MethodGet,
		server.URL+"/courses?sync=true",
		nil,
	)
	first, err := server.Client().Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer first.Body.Close()
	scanner := bufio.NewScanner(first.Body)
	for {
		event, body := readFrame(t, scanner)
		var status operation.OperationStatus
		if event != "status" || json.Unmarshal(body, &status) != nil {
			t.Fatal(event, string(body))
		}
		if status.Progress != nil && status.Progress.Stage == "fetching-courses" {
			break
		}
	}
	// The worker is still waiting, but status events have already arrived.
	detach()
	request, _ = http.NewRequestWithContext(
		ctx,
		http.MethodGet,
		server.URL+"/courses?sync=true",
		nil,
	)
	second, err := server.Client().Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer second.Body.Close()
	scanner = bufio.NewScanner(second.Body)
	for {
		event, body := readFrame(t, scanner)
		var status operation.OperationStatus
		if event != "status" || json.Unmarshal(body, &status) != nil {
			t.Fatal(event, string(body))
		}
		if status.Progress != nil && status.Progress.Stage == "fetching-courses" {
			break
		}
	}
	close(release)
	event, body := readFrame(t, scanner)
	var status operation.OperationStatus
	if event != "status" || json.Unmarshal(body, &status) != nil || status.Status != "succeeded" {
		t.Fatal(event, string(body))
	}
	event, body = readFrame(t, scanner)
	var result struct{ Data []domain.Course }
	if event != "result" || json.Unmarshal(body, &result) != nil || len(result.Data) != 1 {
		t.Fatal(event, string(body))
	}
	if scanner.Scan() || scanner.Err() != nil || fake.courseCalls.Load() != 1 {
		t.Fatal("work duplicated or stream did not end", scanner.Err(), fake.courseCalls.Load())
	}
}

func TestApplicationDoesNotRetryBrowserFailures(t *testing.T) {
	fake := &source{}
	fake.authenticated.Store(true)
	fake.failCourses.Store(1)
	server := streamingServer(t, fake)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	request, _ := http.NewRequestWithContext(
		ctx,
		http.MethodGet,
		server.URL+"/courses?sync=true",
		nil,
	)
	response, err := server.Client().Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	scanner := bufio.NewScanner(response.Body)
	for {
		event, body := readFrame(t, scanner)
		if event == "error" {
			var result struct{ Error domain.Error }
			if json.Unmarshal(body, &result) != nil || result.Error.Reason != "source" {
				t.Fatal(event, string(body))
			}
			break
		}
		if event == "result" {
			t.Fatal("unexpected result", string(body))
		}
	}
	if fake.courseCalls.Load() != 1 || scanner.Scan() || scanner.Err() != nil {
		t.Fatal("application retried browser operation", fake.courseCalls.Load())
	}
}
