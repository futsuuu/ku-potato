//go:build !windows

package filesystem

import (
	"os"
	"os/exec"
	"runtime"
	"time"
)

func openDefault(path string) error {
	name := "xdg-open"
	if runtime.GOOS == "darwin" {
		name = "open"
	}
	command := exec.Command(name, path)
	command.Stderr = os.Stderr
	if runtime.GOOS == "darwin" {
		// macOS open returns after Launch Services handles the request.
		return command.Run()
	}
	return runOpenCommand(command, 2*time.Second)
}

// xdg-open can stay attached to the viewer until it closes. Observe early
// failures without holding the HTTP request open for the viewer's lifetime.
func runOpenCommand(command *exec.Cmd, startup time.Duration) error {
	if err := command.Start(); err != nil {
		return err
	}
	done := make(chan error, 1)
	go func() { done <- command.Wait() }()
	timer := time.NewTimer(startup)
	defer timer.Stop()
	select {
	case err := <-done:
		return err
	case <-timer.C:
		return nil
	}
}
