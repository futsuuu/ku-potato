package userbrowser

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

	userproto "github.com/futsuuu/ku-potato/user-browser/protocol"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/emptypb"
)

func buildUserBrowser(t *testing.T, root string) string {
	t.Helper()
	binary := filepath.Join(root, "ku-potato-user-browser")
	if runtime.GOOS == "windows" {
		binary += ".exe"
	}
	build := exec.Command("go", "build", "-o", binary, "./user-browser/cmd/ku-potato-user-browser")
	build.Dir = "../.."
	if output, err := build.CombinedOutput(); err != nil {
		t.Fatalf("build user browser: %v\n%s", err, output)
	}
	return binary
}

func TestProcessAuthorizationAndWebAuthnStorage(t *testing.T) {
	root := t.TempDir()
	binary := buildUserBrowser(t, root)
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	process, err := Start(ctx, binary, root, filepath.Join(root, "cache"), "")
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = process.Close() }()
	lms := NewLMS(process.Client)
	result, err := lms.WebAuthnRegistrationStatus(ctx)
	if err != nil || result.Registered {
		t.Fatal(result, err)
	}
	if err := lms.DeleteWebAuthn(ctx); err != nil {
		t.Fatal(err)
	}
	conn, err := grpc.NewClient(
		"passthrough:///"+process.Endpoint,
		grpc.WithTransportCredentials(insecure.NewCredentials()),
	)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = conn.Close() }()
	_, err = userproto.NewUserBrowserClient(conn).WebAuthnRegistrationStatus(ctx, &emptypb.Empty{})
	if status.Code(err) != codes.Unauthenticated {
		t.Fatal("unauthorized request accepted", err)
	}
	for _, tokens := range [][]string{{"wrong"}, {"wrong", "also-wrong"}} {
		md := metadata.MD{"x-ku-potato-user-browser-token": tokens}
		_, err := userproto.NewUserBrowserClient(conn).
			DeleteWebAuthn(metadata.NewOutgoingContext(ctx, md), &emptypb.Empty{})
		if status.Code(err) != codes.Unauthenticated {
			t.Fatal("invalid token accepted", err)
		}
	}
	credential := filepath.Join(root, "auth", "kogakuin", "webauthn.json")
	if err := os.MkdirAll(filepath.Dir(credential), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(credential, []byte("invalid"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := lms.WebAuthnRegistrationStatus(ctx); err == nil {
		t.Fatal("corrupt credentials accepted")
	}
	if err := lms.DeleteWebAuthn(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(credential); !os.IsNotExist(err) {
		t.Fatal("credential not deleted", err)
	}
	if err := process.Close(); err != nil {
		t.Fatal(err)
	}
	// Idempotent close and no remaining listener.
	if err := process.Close(); err != nil {
		t.Fatal(err)
	}
	if connection, err := net.DialTimeout(
		"tcp",
		process.Endpoint,
		100*time.Millisecond,
	); err == nil {
		_ = connection.Close()
		t.Fatal("user browser still listening")
	}
}

func TestProcessRejectsInvalidConfiguration(t *testing.T) {
	root := t.TempDir()
	binary := buildUserBrowser(t, root)
	for _, test := range []struct{ token, listen string }{
		{"", "127.0.0.1:0"}, {"token", "0.0.0.0:0"},
	} {
		command := exec.Command(
			binary,
			"-state-dir",
			root,
			"-cache-dir",
			filepath.Join(root, "cache"),
			"-listen",
			test.listen,
		)
		command.Env = append(os.Environ(), "KU_POTATO_USER_BROWSER_TOKEN="+test.token)
		if output, err := command.CombinedOutput(); err == nil {
			t.Fatal("invalid configuration accepted", string(output))
		}
	}
}

func TestUserBrowserStopsWhenParentIsKilled(t *testing.T) {
	if os.Getenv("KU_POTATO_USER_TEST_PARENT") == "1" {
		root := os.Getenv("KU_POTATO_USER_TEST_ROOT")
		process, err := Start(
			context.Background(),
			os.Getenv("KU_POTATO_USER_TEST_BINARY"),
			root,
			filepath.Join(root, "cache"),
			"",
		)
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		if _, err := fmt.Fprintln(os.Stdout, process.Endpoint); err != nil {
			t.Fatal(err)
		}
		for {
			time.Sleep(time.Hour)
		}
	}
	root := t.TempDir()
	binary := buildUserBrowser(t, root)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	command := exec.CommandContext(
		ctx,
		os.Args[0],
		"-test.run=^TestUserBrowserStopsWhenParentIsKilled$",
	)
	command.Env = append(
		os.Environ(),
		"KU_POTATO_USER_TEST_PARENT=1",
		"KU_POTATO_USER_TEST_ROOT="+root,
		"KU_POTATO_USER_TEST_BINARY="+binary,
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
		t.Fatal(err)
	}
	endpoint = strings.TrimSpace(endpoint)
	if _, _, err := net.SplitHostPort(endpoint); err != nil {
		t.Fatal(err)
	}
	if err := command.Process.Kill(); err != nil {
		t.Fatal(err)
	}
	_ = command.Wait()
	for ctx.Err() == nil {
		connection, err := net.DialTimeout("tcp", endpoint, 100*time.Millisecond)
		if err != nil {
			return
		}
		_ = connection.Close()
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("user browser survived parent")
}
