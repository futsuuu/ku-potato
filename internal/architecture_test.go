package internal_test

import (
	"os/exec"
	"strings"
	"testing"
)

func TestPackageBoundaries(t *testing.T) {
	const module = "github.com/futsuuu/ku-potato/"
	command := exec.Command(
		"go",
		"list",
		"-e",
		"-f",
		`{{.ImportPath}} {{join .Imports " "}}`,
		"./internal/...",
		"./desktop/...",
		"./browser-worker/...",
		"./user-browser/...",
	)
	command.Dir = ".."
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("list packages: %v\n%s", err, output)
	}
	for line := range strings.SplitSeq(strings.TrimSpace(string(output)), "\n") {
		fields := strings.Fields(line)
		if len(fields) == 0 {
			continue
		}
		from := strings.TrimPrefix(fields[0], module)
		for _, dependency := range fields[1:] {
			to := strings.TrimPrefix(dependency, module)
			if to == dependency {
				continue
			}
			switch {
			case strings.HasPrefix(from, "internal/") && (strings.HasPrefix(to, "user-browser/") || strings.HasPrefix(to, "browser-worker/")):
				t.Errorf("%s imports browser implementation %s", from, to)
			case strings.HasPrefix(from, "desktop/") && strings.HasPrefix(to, "internal/") && to != "internal/appdirs":
				t.Errorf("%s imports backend package %s", from, to)
			case strings.HasPrefix(from, "desktop/") && (strings.HasPrefix(to, "browser-worker/") || strings.HasPrefix(to, "user-browser/")):
				t.Errorf("%s imports browser service package %s", from, to)
			}
		}
	}
}
