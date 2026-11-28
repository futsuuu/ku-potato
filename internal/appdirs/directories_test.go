package appdirs

import (
	"path/filepath"
	"testing"
)

func TestDirectoriesFollowOSConventionsAndIgnoreRelativeXDG(t *testing.T) {
	home := t.TempDir()
	temp := filepath.Join(home, "temp")
	for _, program := range []string{"server", "browser-worker", "user-browser", "desktop"} {
		t.Run(program, func(t *testing.T) {
			app := func(base string) string { return filepath.Join(base, "ku-potato", program) }
			for _, test := range []struct {
				goos string
				want Directories
			}{
				{"windows", Directories{Data: filepath.Join(app(filepath.Join(home, "AppData", "Local")), "data"), State: filepath.Join(app(filepath.Join(home, "AppData", "Local")), "state"), Cache: filepath.Join(app(filepath.Join(home, "AppData", "Local")), "cache"), Temp: temp}},
				{"darwin", Directories{Data: filepath.Join(app(filepath.Join(home, "Library", "Application Support")), "data"), State: filepath.Join(app(filepath.Join(home, "Library", "Application Support")), "state"), Cache: app(filepath.Join(home, "Library", "Caches")), Temp: temp}},
				{"linux", Directories{Data: app(filepath.Join(home, ".local", "share")), State: app(filepath.Join(home, ".local", "state")), Cache: app(filepath.Join(home, ".cache")), Temp: temp}},
			} {
				t.Run(test.goos, func(t *testing.T) {
					for _, value := range []string{"", "relative"} {
						got := directoriesFor(
							program,
							test.goos,
							home,
							temp,
							func(string) string { return value },
						)
						if got != test.want {
							t.Fatalf("got %#v; want %#v", got, test.want)
						}
					}
				})
			}
			custom := filepath.Join(home, "custom")
			got := directoriesFor(
				program,
				"linux",
				home,
				temp,
				func(string) string { return custom },
			)
			if got.Data != app(custom) || got.State != app(custom) || got.Cache != app(custom) {
				t.Fatal("shared roots rejected", got)
			}
		})
	}
}
