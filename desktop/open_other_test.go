//go:build !windows

package main

import (
	"errors"
	"os/exec"
	"testing"
	"time"
)

func TestRunOpenCommandReportsLaunchFailures(t *testing.T) {
	if err := runOpenCommand(
		exec.Command("missing-ku-potato-opener-command"),
		time.Second,
	); err == nil {
		t.Fatal("missing opener was reported as success")
	}
	var exit *exec.ExitError
	if err := runOpenCommand(
		exec.Command("sh", "-c", "exit 3"),
		time.Second,
	); !errors.As(err, &exit) ||
		exit.ExitCode() != 3 {
		t.Fatal("non-zero opener exit was not reported", err)
	}
}

func TestRunOpenCommandDoesNotWaitForViewer(t *testing.T) {
	start := time.Now()
	if err := runOpenCommand(
		exec.Command("sh", "-c", "sleep 1"),
		20*time.Millisecond,
	); err != nil ||
		time.Since(start) > 500*time.Millisecond {
		t.Fatal("opening waited for viewer to close", err)
	}
}
