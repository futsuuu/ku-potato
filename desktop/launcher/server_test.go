package launcher

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"testing"
	"time"
)

func TestMain(m *testing.M) {
	switch os.Getenv("KU_POTATO_LAUNCHER_TEST_MODE") {
	case "parent":
		_ = os.Setenv("KU_POTATO_LAUNCHER_TEST_MODE", "child")
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		binary, _ := os.Executable()
		_, err := (Manager{Endpoint: os.Getenv("KU_POTATO_LAUNCHER_TEST_ENDPOINT"), StateDir: os.Getenv("KU_POTATO_LAUNCHER_TEST_STATE"), Binary: binary}).Ensure(ctx)
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		os.Exit(0)
	case "child":
		address := os.Getenv("KU_POTATO_LAUNCHER_TEST_ENDPOINT")[len("http://"):]
		mux := http.NewServeMux()
		server := &http.Server{Addr: address, Handler: mux, ReadHeaderTimeout: time.Second}
		mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
			_, _ = fmt.Fprint(w, `{"status":"ok","service":"ku-potato-server"}`)
		})
		mux.HandleFunc("/quit", func(w http.ResponseWriter, r *http.Request) { go server.Shutdown(context.Background()) })
		_ = server.ListenAndServe()
		os.Exit(0)
	}
	os.Exit(m.Run())
}

func prepareDevelopmentBinary(t *testing.T) string {
	t.Helper()
	t.Chdir(t.TempDir())
	t.Setenv("PATH", "")
	name := "ku-potato-server"
	if runtime.GOOS == "windows" {
		name += ".exe"
	}
	binary := filepath.Join("desktop", "build", "bin", name)
	if err := os.MkdirAll(filepath.Dir(binary), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(binary, nil, 0700); err != nil {
		t.Fatal(err)
	}
	return binary
}

func TestRunningServerIsReusedWithoutLaunchingBinary(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = fmt.Fprint(w, `{"status":"ok","service":"ku-potato-server"}`)
	}))
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	url, err := (Manager{Endpoint: server.URL, Binary: "missing-binary"}).Ensure(ctx)
	if err != nil || url != server.URL {
		t.Fatalf("reuse failed: %s %v", url, err)
	}
}

func TestUnrelatedServerIsRejected(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = fmt.Fprint(w, `{"status":"ok"}`) }))
	defer server.Close()
	if _, err := (Manager{Endpoint: server.URL}).Ensure(context.Background()); err == nil {
		t.Fatal("unrelated server accepted")
	}
}

func TestDetachedServerSurvivesDesktopProcessExit(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	endpoint := "http://" + listener.Addr().String()
	_ = listener.Close()
	t.Setenv("KU_POTATO_LAUNCHER_TEST_MODE", "parent")
	t.Setenv("KU_POTATO_LAUNCHER_TEST_ENDPOINT", endpoint)
	t.Setenv("KU_POTATO_LAUNCHER_TEST_STATE", t.TempDir())
	binary, _ := os.Executable()
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	output, err := exec.CommandContext(ctx, binary).CombinedOutput()
	if err != nil {
		t.Fatalf("parent exited: %v %s", err, output)
	}
	defer func() {
		request, _ := http.NewRequest("POST", endpoint+"/quit", nil)
		client := &http.Client{Timeout: time.Second}
		if response, err := client.Do(request); err == nil {
			response.Body.Close()
		}
	}()
	ready, err := probe(ctx, endpoint)
	if err != nil || !ready {
		t.Fatalf("detached child exited with parent: %v", err)
	}
	if _, err := (Manager{Endpoint: endpoint, Binary: "missing-binary"}).Ensure(ctx); err != nil {
		t.Fatal(err)
	}
}
