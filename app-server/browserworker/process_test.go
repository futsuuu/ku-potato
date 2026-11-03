package browserworker

import (
	"bufio"
	"context"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	workerproto "github.com/futsuuu/ku-potato/browser-worker/protocol"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/status"
)

func buildWorker(t *testing.T, root string) string {
	t.Helper()
	binary := filepath.Join(root, "ku-potato-browser-worker")
	if runtime.GOOS == "windows" {
		binary += ".exe"
	}
	build := exec.Command(
		"go",
		"build",
		"-o",
		binary,
		"./browser-worker/cmd/ku-potato-browser-worker",
	)
	build.Dir = "../.."
	if output, err := build.CombinedOutput(); err != nil {
		t.Fatalf("build worker: %v\n%s", err, output)
	}
	return binary
}

func TestProcessRequiresAuthorization(t *testing.T) {
	root := t.TempDir()
	binary := buildWorker(t, root)
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
	conn, err := grpc.NewClient(
		"passthrough:///"+process.endpoint,
		grpc.WithTransportCredentials(insecure.NewCredentials()),
	)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	_, err = workerproto.NewBrowserWorkerClient(conn).SetSSOCookies(ctx, &workerproto.SSOCookies{})
	if status.Code(err) != codes.Unauthenticated {
		t.Fatalf("unauthenticated call accepted: %v", err)
	}
}

func TestWorkerStopsWhenParentIsKilled(t *testing.T) {
	if os.Getenv("KU_POTATO_TEST_PARENT") == "1" {
		process, err := Start(
			context.Background(),
			os.Getenv("KU_POTATO_TEST_WORKER"),
			os.Getenv("KU_POTATO_TEST_ROOT"),
			"",
			1,
		)
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		fmt.Fprintln(os.Stdout, process.endpoint)
		for {
			time.Sleep(time.Hour)
		}
	}

	root := t.TempDir()
	binary := buildWorker(t, root)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	command := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestWorkerStopsWhenParentIsKilled$")
	command.Env = append(
		os.Environ(),
		"KU_POTATO_TEST_PARENT=1",
		"KU_POTATO_TEST_WORKER="+binary,
		"KU_POTATO_TEST_ROOT="+root,
	)
	command.Stderr = os.Stderr
	stdout, err := command.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err := command.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() {
		if command.ProcessState == nil {
			_ = command.Process.Kill()
			_ = command.Wait()
		}
	}()
	endpoint, err := bufio.NewReader(stdout).ReadString('\n')
	if err != nil {
		t.Fatalf("read worker endpoint: %v", err)
	}
	endpoint = strings.TrimSpace(endpoint)
	if _, _, err := net.SplitHostPort(endpoint); err != nil {
		t.Fatalf("invalid worker endpoint %q: %v", endpoint, err)
	}
	if err := command.Process.Kill(); err != nil {
		t.Fatal(err)
	}
	_ = command.Wait()

	for ctx.Err() == nil {
		entries, err := os.ReadDir(root)
		if err != nil {
			t.Fatal(err)
		}
		alive := false
		for _, entry := range entries {
			alive = alive || strings.HasPrefix(entry.Name(), "browser-worker-")
		}
		if !alive {
			connection, err := net.DialTimeout("tcp", endpoint, 100*time.Millisecond)
			if err != nil {
				return
			}
			connection.Close()
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("browser worker remained after its parent was killed")
}
