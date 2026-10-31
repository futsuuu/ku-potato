//go:build !windows

package browserworker

import "os/exec"

func configureWorkerProcess(command *exec.Cmd) {}
