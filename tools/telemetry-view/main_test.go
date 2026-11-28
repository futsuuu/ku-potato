package main

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/futsuuu/ku-potato/internal/appdirs"
)

func TestRecordingVolumesExposeOnlySelectedDirectories(t *testing.T) {
	home := t.TempDir()
	for _, name := range []string{"HOME", "USERPROFILE", "XDG_STATE_HOME", "LOCALAPPDATA"} {
		t.Setenv(name, home)
	}
	if _, err := recordingVolumes(nil); err == nil {
		t.Fatal("missing recordings were accepted")
	}
	var expected []string
	for _, program := range []string{"server", "browser-worker", "user-browser"} {
		directories, err := appdirs.DefaultDirectories(program)
		if err != nil {
			t.Fatal(err)
		}
		directory := filepath.Join(directories.State, "telemetry")
		if err := os.MkdirAll(directory, 0o700); err != nil {
			t.Fatal(err)
		}
		expected = append(expected, directory)
		volumes, err := recordingVolumes(nil)
		if err != nil || len(volumes) != len(expected) {
			t.Fatalf("recording volumes: %v %v", volumes, err)
		}
		for index, source := range expected {
			if volumes[index]["source"] != source || volumes[index]["read_only"] != true {
				t.Fatalf("unexpected recording volume: %v", volumes[index])
			}
		}
	}
	directory := t.TempDir()
	volumes, err := recordingVolumes([]string{directory})
	if err != nil || len(volumes) != 1 {
		t.Fatalf("recording volumes: %v %v", volumes, err)
	}
	if volumes[0]["source"] != directory || volumes[0]["read_only"] != true {
		t.Fatalf("unexpected recording volume: %v", volumes[0])
	}
}
