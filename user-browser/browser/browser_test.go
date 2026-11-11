package browser

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

func testChrome(t *testing.T) string {
	t.Helper()
	for _, name := range []string{"google-chrome", "chromium", "msedge", "chrome"} {
		if value, err := exec.LookPath(name); err == nil {
			return value
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
