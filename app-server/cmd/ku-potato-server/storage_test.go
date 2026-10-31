package main

import (
	"bufio"
	"context"
	"flag"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func TestServerRejectsSecondProcessWithDifferentDataAndPort(t *testing.T) {
	if data := os.Getenv("KU_POTATO_SERVER_TEST_DATA"); data != "" {
		flag.CommandLine = flag.NewFlagSet("server-test", flag.ContinueOnError)
		os.Args = []string{os.Args[0], "-data-dir", data, "-state-dir", filepath.Join(data, "state"), "-cache-dir", filepath.Join(data, "cache"), "-temp-dir", filepath.Join(data, "temp"), "-listen", "127.0.0.1:0", "-worker", os.Getenv("KU_POTATO_TEST_WORKER")}
		if err := run(); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(2)
		}
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	base := t.TempDir()
	worker := filepath.Join(base, "ku-potato-browser-worker")
	if runtime.GOOS == "windows" {
		worker += ".exe"
	}
	build := exec.CommandContext(ctx, "go", "build", "-o", worker, "./browser-worker/cmd/ku-potato-browser-worker")
	build.Dir = "../../.."
	if output, err := build.CombinedOutput(); err != nil {
		t.Fatalf("build worker: %v\n%s", err, output)
	}
	newCommand := func(data string) *exec.Cmd {
		cmd := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestServerRejectsSecondProcessWithDifferentDataAndPort$")
		cmd.Env = append(os.Environ(), "KU_POTATO_SERVER_TEST_DATA="+data, "KU_POTATO_TEST_WORKER="+worker,
			"LOCALAPPDATA="+base, "XDG_DATA_HOME="+base, "XDG_STATE_HOME="+base, "XDG_CACHE_HOME="+base, "HOME="+base)
		return cmd
	}
	first := newCommand(filepath.Join(base, "first"))
	stderr, err := first.StderrPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err := first.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = first.Process.Kill(); _ = first.Wait() })
	ready := make(chan bool, 1)
	go func() {
		scanner := bufio.NewScanner(stderr)
		for scanner.Scan() {
			if strings.Contains(scanner.Text(), "HTTP server listening") {
				ready <- true
				return
			}
		}
		ready <- false
	}()
	select {
	case ok := <-ready:
		if !ok {
			t.Fatal("first server failed to start")
		}
	case <-ctx.Done():
		t.Fatal("first server startup timeout")
	}
	second := newCommand(filepath.Join(base, "second"))
	out, err := second.CombinedOutput()
	if err == nil || !strings.Contains(string(out), "another ku-potato server is already running") {
		t.Fatalf("second server was not rejected: %v\n%s", err, out)
	}
}

func TestSingletonLockAcrossProcesses(t *testing.T) {
	if dir := os.Getenv("KU_POTATO_LOCK_TEST_DIR"); dir != "" {
		lock, err := acquireServerLock(dir)
		if os.Getenv("KU_POTATO_LOCK_EXPECT_BUSY") == "1" {
			if err == nil {
				lock.Close()
				t.Fatal("second process acquired lock")
			}
			return
		}
		if err != nil {
			t.Fatal(err)
		}
		if err := lock.Close(); err != nil {
			t.Fatal(err)
		}
		return
	}
	dir := t.TempDir()
	lock, err := acquireServerLock(dir)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { lock.Close() })
	child := func(busy string) {
		t.Helper()
		cmd := exec.Command(os.Args[0], "-test.run=^TestSingletonLockAcrossProcesses$")
		cmd.Env = append(os.Environ(), "KU_POTATO_LOCK_TEST_DIR="+dir, "KU_POTATO_LOCK_EXPECT_BUSY="+busy)
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("child: %v\n%s", err, out)
		}
	}
	child("1")
	if err := lock.Close(); err != nil {
		t.Fatal(err)
	}
	child("0")
	if _, err := os.Stat(filepath.Join(dir, "server.lock")); err != nil {
		t.Fatal("lock file must remain", err)
	}
}
