//go:build !windows

package grpcprocess

import "os/exec"

func configureProcess(command *exec.Cmd) {}
