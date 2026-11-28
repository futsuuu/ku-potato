package main

import (
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/futsuuu/ku-potato/internal/appdirs"
)

func main() {
	flag.Usage = func() {
		_, _ = fmt.Fprintln(
			flag.CommandLine.Output(),
			"Usage: go run ./tools/telemetry-view [--stop] [recording-directory]",
		)
		if directories, err := defaultRecordingDirectories(); err != nil {
			_, _ = fmt.Fprintf(
				flag.CommandLine.Output(),
				"\nDefault recording-directories: unavailable (%v)\n",
				err,
			)
		} else {
			_, _ = fmt.Fprintf(
				flag.CommandLine.Output(),
				"\nDefault recording-directories:\n%s\n",
				strings.Join(directories, "\n"),
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

func defaultRecordingDirectories() ([]string, error) {
	var recordings []string
	for _, program := range []string{"server", "browser-worker", "user-browser"} {
		directories, err := appdirs.DefaultDirectories(program)
		if err != nil {
			return nil, err
		}
		recordings = append(recordings, filepath.Join(directories.State, "telemetry"))
	}
	return recordings, nil
}

func recordingVolumes(arguments []string) ([]map[string]any, error) {
	directories := arguments
	if len(directories) == 0 {
		var err error
		directories, err = defaultRecordingDirectories()
		if err != nil {
			return nil, err
		}
	}
	var volumes []map[string]any
	for _, directory := range directories {
		directory, err := filepath.Abs(directory)
		if err != nil {
			return nil, err
		}
		info, err := os.Stat(directory)
		if os.IsNotExist(err) && len(arguments) == 0 {
			continue
		}
		if err != nil {
			return nil, fmt.Errorf("open telemetry recording %q: %w", directory, err)
		}
		if !info.IsDir() {
			return nil, fmt.Errorf("telemetry recording is not a directory: %s", directory)
		}
		volumes = append(volumes, map[string]any{
			"type": "bind", "source": directory,
			"target": fmt.Sprintf("/data/%d", len(volumes)), "read_only": true,
		})
	}
	if len(volumes) == 0 {
		return nil, errors.New("no telemetry recording directories found")
	}
	return volumes, nil
}

func run(arguments []string, stop bool) error {
	if len(arguments) > 1 {
		return errors.New("expected at most one recording directory; use --help for usage")
	}
	composeArguments := []string{"-f", "tools/telemetry-view/compose.yaml"}
	if stop {
		composeArguments = append(composeArguments, "down")
	} else {
		volumes, err := recordingVolumes(arguments)
		if err != nil {
			return err
		}
		configuration, err := os.CreateTemp("", "ku-potato-telemetry-*.json")
		if err != nil {
			return err
		}
		defer func() { _ = os.Remove(configuration.Name()) }()
		err = json.NewEncoder(configuration).Encode(map[string]any{
			"services": map[string]any{"replay": map[string]any{"volumes": volumes}},
		})
		if err := errors.Join(err, configuration.Close()); err != nil {
			return err
		}
		composeArguments = append(composeArguments, "-f", configuration.Name(), "up", "-d")
	}
	command := exec.Command("podman-compose", composeArguments...)
	command.Stdin, command.Stdout, command.Stderr = os.Stdin, os.Stdout, os.Stderr
	return command.Run()
}
