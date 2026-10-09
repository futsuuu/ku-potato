package chromedp

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"
)

func TestLogoutWaitsForWindowsProfileHandles(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("Windows prevents removal while browser files are open")
	}
	b, err := New(Options{StateDir: t.TempDir(), CacheDir: t.TempDir(), DownloadDir: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { b.Close() })
	profile := filepath.Join(b.opts.StateDir, "profile")
	if err := os.Mkdir(profile, 0700); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(profile, "browser-helper")
	file, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	if err := os.Remove(path); err == nil {
		t.Skip("this filesystem permits removing open files")
	}
	released := make(chan struct{})
	go func() {
		defer close(released)
		time.Sleep(150 * time.Millisecond)
		file.Close()
	}()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	err = b.Logout(ctx)
	<-released
	if err != nil {
		t.Fatal("logout failed before the browser helper released its handle", err)
	}
	if _, err := os.Stat(profile); !os.IsNotExist(err) {
		t.Fatal("profile retained after logout", err)
	}
}
