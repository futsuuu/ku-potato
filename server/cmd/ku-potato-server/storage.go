package main

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/gofrs/flock"
)

// Use the default state directory regardless of the directory/listen flags.
// Keep the lock file: unlinking it while locked would allow a second lock inode.
func acquireServerLock(stateDir string) (*flock.Flock, error) {
	if err := os.MkdirAll(stateDir, 0700); err != nil {
		return nil, err
	}
	lock := flock.New(filepath.Join(stateDir, "server.lock"))
	locked, err := lock.TryLock()
	if err != nil {
		_ = lock.Close()
		return nil, err
	}
	if !locked {
		_ = lock.Close()
		return nil, fmt.Errorf("another ku-potato server is already running for this OS user")
	}
	return lock, nil
}
