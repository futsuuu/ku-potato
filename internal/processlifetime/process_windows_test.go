package processlifetime

import (
	"os"
	"os/exec"
	"testing"
	"time"

	"golang.org/x/sys/windows"
)

func TestBindToParentStopsChildOnRelease(t *testing.T) {
	if os.Getenv("KU_POTATO_LIFETIME_TEST_CHILD") == "1" {
		for {
			time.Sleep(time.Hour)
		}
	}

	child := exec.Command(os.Args[0], "-test.run=^TestBindToParentStopsChildOnRelease$")
	child.Env = append(os.Environ(), "KU_POTATO_LIFETIME_TEST_CHILD=1")
	if err := child.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() { _ = child.Process.Kill() }()

	release, err := BindToParent(child.Process)
	if err != nil {
		_ = child.Process.Kill()
		_ = child.Wait()
		t.Fatal(err)
	}
	handle, err := windows.OpenProcess(windows.SYNCHRONIZE, false, uint32(child.Process.Pid))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = windows.CloseHandle(handle) }()
	done := make(chan error, 1)
	go func() { done <- child.Wait() }()
	select {
	case err := <-done:
		release()
		t.Fatalf("child exited before closing its lifetime handle: %v", err)
	case <-time.After(100 * time.Millisecond):
	}

	release()
	release() // Releasing the lifetime handle is idempotent.
	if state, err := windows.WaitForSingleObject(
		handle,
		0,
	); err != nil ||
		state != windows.WAIT_OBJECT_0 {
		t.Fatalf("release returned before the child exited: state=%d err=%v", state, err)
	}
	select {
	case <-done:
		// Windows may report exit code 0 when a job closes and kills its processes.
	case <-time.After(10 * time.Second):
		t.Fatal("child survived closing its lifetime handle")
	}
}
