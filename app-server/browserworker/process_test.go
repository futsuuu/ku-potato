package browserworker

import (
	"context"
	"os/exec"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	workerproto "github.com/futsuuu/ku-potato/browser-worker/protocol"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/status"
)

func TestProcessRequiresAuthorization(t *testing.T) {
	root := t.TempDir()
	binary := filepath.Join(root, "ku-potato-browser-worker")
	if runtime.GOOS == "windows" {
		binary += ".exe"
	}
	build := exec.Command("go", "build", "-o", binary, "./browser-worker/cmd/ku-potato-browser-worker")
	build.Dir = "../.."
	if output, err := build.CombinedOutput(); err != nil {
		t.Fatalf("build worker: %v\n%s", err, output)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	process, err := Start(ctx, binary, root, "", 1)
	if err != nil {
		t.Fatal(err)
	}
	defer process.Close()
	if _, err := process.Client.SetSSOCookies(ctx, &workerproto.SSOCookies{}); err != nil {
		t.Fatal(err)
	}
	conn, err := grpc.NewClient("passthrough:///"+process.endpoint, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	_, err = workerproto.NewBrowserWorkerClient(conn).SetSSOCookies(ctx, &workerproto.SSOCookies{})
	if status.Code(err) != codes.Unauthenticated {
		t.Fatalf("unauthenticated call accepted: %v", err)
	}
}
