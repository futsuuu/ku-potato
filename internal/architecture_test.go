package internal_test

import (
	"os/exec"
	"strings"
	"testing"
)

func TestPackageBoundaries(t *testing.T) {
	const module = "github.com/futsuuu/ku-potato/"
	command := exec.Command("go", "list", "-e", "-f", `{{.ImportPath}} {{join .Imports " "}}`, "./internal/...", "./desktop/...", "./app-server/...", "./browser-worker/...")
	command.Dir = ".."
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("list packages: %v\n%s", err, output)
	}
	for _, line := range strings.Split(strings.TrimSpace(string(output)), "\n") {
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
			case strings.HasPrefix(from, "browser-worker/") && strings.HasPrefix(to, "app-server/"):
				t.Errorf("%s imports app-server package %s", from, to)
			case strings.HasPrefix(from, "app-server/") && strings.HasPrefix(to, "browser-worker/") && to != "browser-worker/protocol":
				t.Errorf("%s imports browser worker implementation %s", from, to)
			case strings.HasPrefix(from, "desktop/") && strings.HasPrefix(to, "internal/") && to != "internal/appdirs":
				t.Errorf("%s imports backend package %s", from, to)
			case strings.HasPrefix(from, "internal/") && strings.HasPrefix(to, "app-server/"):
				t.Errorf("%s imports app-server package %s", from, to)
			case strings.HasPrefix(from, "internal/") && strings.HasPrefix(to, "browser-worker/"):
				t.Errorf("%s imports browser worker implementation %s", from, to)
			case strings.HasPrefix(from, "app-server/application/") && (strings.HasPrefix(to, "app-server/httpapi") || strings.HasPrefix(to, "app-server/sqlite")):
				t.Errorf("%s imports adapter %s", from, to)
			}
		}
	}
}

func TestWorkerDependencyClosure(t *testing.T) {
	const module = "github.com/futsuuu/ku-potato/"
	command := exec.Command("go", "list", "-deps", "-f", "{{.ImportPath}}", "./browser-worker/...")
	command.Dir = ".."
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("list worker dependencies: %v\n%s", err, output)
	}
	for _, dependency := range strings.Fields(string(output)) {
		if strings.HasPrefix(dependency, module+"app-server/") || dependency == module+"app-server" {
			t.Errorf("worker depends on app-server package %s", dependency)
		}
	}
}
