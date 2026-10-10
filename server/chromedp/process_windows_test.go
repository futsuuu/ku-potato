package chromedp

import (
	"bytes"
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"

	cd "github.com/chromedp/chromedp"
	"golang.org/x/sys/windows"
)

func TestChromeStopsWhenDetachedOwnerIsKilled(t *testing.T) {
	if dir := os.Getenv("KU_POTATO_BROWSER_OWNER_TEST_DIR"); dir != "" {
		b, err := New(Options{StateDir: filepath.Join(dir, "state"), CacheDir: filepath.Join(dir, "cache"), DownloadDir: filepath.Join(dir, "downloads"), Executable: os.Getenv("CHROME_PATH")})
		if err != nil {
			t.Fatal(err)
		}
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		if err := b.start(ctx, false); err != nil {
			t.Fatal(err)
		}
		pid := cd.FromContext(b.root).Browser.Process().Pid
		if err := os.WriteFile(filepath.Join(dir, "chrome.pid"), []byte(strconv.Itoa(pid)), 0600); err != nil {
			t.Fatal(err)
		}
		// Intentionally leave Close uncalled: the parent forcibly kills this owner.
		select {}
	}

	executable := testChrome(t)
	dir := t.TempDir()
	binary, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	command := exec.CommandContext(ctx, binary, "-test.run=^TestChromeStopsWhenDetachedOwnerIsKilled$", "-test.timeout=40s")
	command.Env = append(os.Environ(), "KU_POTATO_BROWSER_OWNER_TEST_DIR="+dir, "CHROME_PATH="+executable)
	command.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x00000008 | 0x00000200}
	var output bytes.Buffer
	command.Stdout, command.Stderr = &output, &output
	if err := command.Start(); err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() { done <- command.Wait() }()
	t.Cleanup(func() { _ = command.Process.Kill() })
	var pid int
	deadline := time.NewTimer(20 * time.Second)
	defer deadline.Stop()
	ticker := time.NewTicker(50 * time.Millisecond)
	defer ticker.Stop()
waitForChrome:
	for {
		select {
		case <-ticker.C:
			body, err := os.ReadFile(filepath.Join(dir, "chrome.pid"))
			if err != nil {
				continue
			}
			pid, err = strconv.Atoi(strings.TrimSpace(string(body)))
			if err != nil {
				continue
			}
			break waitForChrome
		case err := <-done:
			t.Fatalf("owner exited before Chrome started: %v %s", err, output.String())
		case <-deadline.C:
			t.Fatal("owner did not start Chrome")
		}
	}
	handle, err := windows.OpenProcess(windows.SYNCHRONIZE|windows.PROCESS_TERMINATE, false, uint32(pid))
	if err != nil {
		t.Fatal(err)
	}
	defer windows.CloseHandle(handle)
	defer windows.TerminateProcess(handle, 1)
	if err := command.Process.Kill(); err != nil {
		t.Fatal(err)
	}
	<-done
	status, err := windows.WaitForSingleObject(handle, 10000)
	if err != nil || status != windows.WAIT_OBJECT_0 {
		t.Fatalf("Chrome outlived its owner: status=%d error=%v", status, err)
	}
	// A new owner must immediately be able to reuse the persistent profile.
	b, err := New(Options{StateDir: filepath.Join(dir, "state"), CacheDir: filepath.Join(dir, "cache"), DownloadDir: filepath.Join(dir, "downloads"), Executable: executable})
	if err != nil {
		t.Fatal(err)
	}
	defer b.Close()
	if err := b.start(ctx, false); err != nil {
		t.Fatal("profile remained locked after owner exited", err)
	}
}
