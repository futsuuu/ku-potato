package main

import (
	"errors"
	"flag"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"

	"github.com/futsuuu/ku-potato/internal/appdirs"
)

func main() {
	flag.Usage = func() {
		_, _ = fmt.Fprintln(
			flag.CommandLine.Output(),
			"Usage: go run ./tools/telemetry-view [--stop] [recording-directory]",
		)
		if directories, err := appdirs.DefaultDirectories(); err != nil {
			_, _ = fmt.Fprintf(
				flag.CommandLine.Output(),
				"\nDefault recording-directory: unavailable (%v)\n",
				err,
			)
		} else {
			_, _ = fmt.Fprintf(
				flag.CommandLine.Output(),
				"\nDefault recording-directory: %s\n",
				filepath.Join(directories.State, "telemetry"),
			)
		}
	}
	stop := flag.Bool("stop", false, "stop the viewer")
	flag.Parse()
	if err := run(flag.Args(), *stop); err != nil {
		log.Print(err)
		var exitError *exec.ExitError
		if errors.As(err, &exitError) && exitError.ExitCode() > 0 {
			os.Exit(exitError.ExitCode())
		}
		os.Exit(1)
	}
}

func run(arguments []string, stop bool) error {
	if len(arguments) > 1 {
		return errors.New("expected at most one recording directory; use --help for usage")
	}
	var directory string
	if len(arguments) == 1 {
		directory = arguments[0]
	} else {
		directories, err := appdirs.DefaultDirectories()
		if err != nil {
			return err
		}
		directory = filepath.Join(directories.State, "telemetry")
	}
	directory, err := filepath.Abs(directory)
	if err != nil {
		return err
	}
	if !stop {
		info, err := os.Stat(directory)
		if err != nil {
			return fmt.Errorf("open telemetry recording %q: %w", directory, err)
		}
		if !info.IsDir() {
			return fmt.Errorf("telemetry recording is not a directory: %s", directory)
		}
	}
	composeArguments := []string{"-f", "tools/telemetry-view/compose.yaml"}
	if stop {
		composeArguments = append(composeArguments, "down")
	} else {
		composeArguments = append(composeArguments, "up", "-d")
	}
	command := exec.Command("podman-compose", composeArguments...)
	command.Env = append(os.Environ(), "TELEMETRY_DIRECTORY="+directory)
	command.Stdin, command.Stdout, command.Stderr = os.Stdin, os.Stdout, os.Stderr
	return command.Run()
}
