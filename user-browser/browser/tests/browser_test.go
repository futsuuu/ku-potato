package tests

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

func chrome(t *testing.T) string {
	t.Helper()
	if path := os.Getenv("KU_POTATO_TEST_BROWSER"); path != "" {
		value, err := exec.LookPath(path)
		if err != nil {
			t.Fatal(err)
		}
		return value
	}
	for _, name := range []string{"google-chrome", "chromium", "chromium-browser", "msedge", "chrome"} {
		if path, err := exec.LookPath(name); err == nil {
			return path
		}
	}
	for _, path := range []string{filepath.Join(os.Getenv("LOCALAPPDATA"), "Google", "Chrome", "Application", "chrome.exe"), `C:\Program Files\Google\Chrome\Application\chrome.exe`, `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`} {
		if _, err := os.Stat(path); err == nil {
			return path
		}
	}
	t.Skip("Chrome unavailable")
	return ""
}
