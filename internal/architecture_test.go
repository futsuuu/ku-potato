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
		"./app-server/...",
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
			case (from == "user-browser" || strings.HasPrefix(from, "user-browser/")) && strings.HasPrefix(to, "app-server/"):
				t.Errorf("%s imports app-server package %s", from, to)
			case strings.HasPrefix(from, "app-server/") && (to == "user-browser" || strings.HasPrefix(to, "user-browser/")) && to != "user-browser/protocol":
				t.Errorf("%s imports user browser implementation %s", from, to)
			case strings.HasPrefix(from, "internal/") && (to == "user-browser" || strings.HasPrefix(to, "user-browser/")):
				t.Errorf("%s imports user browser implementation %s", from, to)
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

func TestBrowserServicesDependencyClosure(t *testing.T) {
	const module = "github.com/futsuuu/ku-potato/"
	command := exec.Command(
		"go",
		"list",
		"-deps",
		"-f",
		"{{.ImportPath}}",
		"./browser-worker/...",
		"./user-browser/...",
	)
	command.Dir = ".."
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("list browser service dependencies: %v\n%s", err, output)
	}
	for dependency := range strings.FieldsSeq(string(output)) {
		if strings.HasPrefix(dependency, module+"app-server/") ||
			dependency == module+"app-server" {
			t.Errorf("browser service depends on app-server package %s", dependency)
		}
	}
}

func TestAppServerDoesNotEmbedChrome(t *testing.T) {
	command := exec.Command(
		"go",
		"list",
		"-deps",
		"-f",
		"{{.ImportPath}}",
		"./app-server/cmd/ku-potato-server",
	)
	command.Dir = ".."
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("list app server dependencies: %v\n%s", err, output)
	}
	for dependency := range strings.FieldsSeq(string(output)) {
		if strings.HasPrefix(dependency, "github.com/chromedp/") {
			t.Errorf("app server embeds Chrome dependency %s", dependency)
		}
	}
}
