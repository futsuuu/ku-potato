package appdirs

import (
	"os"
	"path/filepath"
	"runtime"
)

type Directories struct{ Data, State, Cache, Temp string }

func DefaultDirectories(program string) (Directories, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return Directories{}, err
	}
	return directoriesFor(program, runtime.GOOS, home, os.TempDir(), os.Getenv), nil
}

func directoriesFor(program, goos, home, temp string, getenv func(string) string) Directories {
	app := func(base string) string { return filepath.Join(base, "ku-potato", program) }
	envDir := func(name, fallback string) string {
		value := getenv(name)
		if value == "" || !filepath.IsAbs(value) {
			return fallback
		}
		return value
	}
	var dirs Directories
	switch goos {
	case "windows":
		base := app(envDir("LOCALAPPDATA", filepath.Join(home, "AppData", "Local")))
		dirs = Directories{
			Data:  filepath.Join(base, "data"),
			State: filepath.Join(base, "state"),
			Cache: filepath.Join(base, "cache"),
		}
	case "darwin":
		base := app(filepath.Join(home, "Library", "Application Support"))
		dirs = Directories{
			Data:  filepath.Join(base, "data"),
			State: filepath.Join(base, "state"),
			Cache: app(filepath.Join(home, "Library", "Caches")),
		}
	default:
		dirs = Directories{
			Data:  app(envDir("XDG_DATA_HOME", filepath.Join(home, ".local", "share"))),
			State: app(envDir("XDG_STATE_HOME", filepath.Join(home, ".local", "state"))),
			Cache: app(envDir("XDG_CACHE_HOME", filepath.Join(home, ".cache"))),
		}
	}
	dirs.Temp = temp
	return dirs
}
