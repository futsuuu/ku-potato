package tests

import (
	"bytes"
	"context"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	adapter "github.com/futsuuu/ku-potato/server/chromedp"
	"github.com/futsuuu/ku-potato/server/domain"
	"github.com/futsuuu/ku-potato/server/platform"
	"github.com/gofrs/flock"
)

type liveFixture struct {
	browser                 *adapter.Browser
	source, auth, downloads string
	hasKey                  bool
	courses                 []domain.Course
	materials               map[string]domain.Snapshot
	resources               map[string]domain.Snapshot
}

func newLiveFixture(t *testing.T) *liveFixture {
	t.Helper()
	if testing.Short() {
		t.Skip("live tests disabled by -short")
	}
	defaults, err := platform.DefaultDirectories()
	if err != nil {
		t.Fatal("resolve authentication directory", err)
	}
	state := defaults.State
	source := filepath.Join(state, "auth", "kogakuin")
	if _, err := os.Stat(source); os.IsNotExist(err) {
		t.Skip("no saved server authentication")
	} else if err != nil {
		t.Fatal("read authentication directory", err)
	}
	if err := os.MkdirAll(state, 0700); err != nil {
		t.Fatal("create authentication lock directory", err)
	}
	lock := flock.New(filepath.Join(state, "server.lock"))
	locked, err := lock.TryLock()
	if err != nil {
		lock.Close()
		t.Fatal("lock authentication state", err)
	}
	if !locked {
		lock.Close()
		t.Skip("server is running; stop it to run live tests")
	}
	t.Cleanup(func() { lock.Close() })
	body, err := os.ReadFile(filepath.Join(source, "webauthn.json"))
	if os.IsNotExist(err) {
		t.Skip("no saved WebAuthn credential")
	}
	if err != nil {
		t.Fatal("read saved WebAuthn credential", err)
	}
	f := &liveFixture{
		source: source, auth: t.TempDir(), downloads: t.TempDir(), hasKey: true,
		materials: map[string]domain.Snapshot{}, resources: map[string]domain.Snapshot{},
	}
	if err := os.MkdirAll(filepath.Join(f.auth, "auth", "kogakuin"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := replaceAuthentication(filepath.Join(f.auth, "auth", "kogakuin", "webauthn.json"), body); err != nil {
		t.Fatal("prepare test authentication", err)
	}
	f.browser, err = adapter.New(adapter.Options{
		StateDir: f.auth, CacheDir: t.TempDir(), DownloadDir: f.downloads,
		Executable: chrome(t), Parallelism: 4,
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := f.persistAuthentication(); err != nil {
			t.Error("persist authentication after live tests", err)
		}
		f.browser.Close()
	})
	return f
}

func sameDirectory(a, b string) bool {
	a, b = filepath.Clean(a), filepath.Clean(b)
	if runtime.GOOS == "windows" {
		return strings.EqualFold(a, b)
	}
	return a == b
}

func replaceAuthentication(path string, body []byte) error {
	file, err := os.CreateTemp(filepath.Dir(path), ".live-auth-*")
	if err != nil {
		return err
	}
	defer os.Remove(file.Name())
	defer file.Close()
	if err := file.Chmod(0600); err != nil {
		return err
	}
	if _, err := file.Write(body); err != nil {
		return err
	}
	if err := file.Sync(); err != nil {
		return err
	}
	if err := file.Close(); err != nil {
		return err
	}
	return os.Rename(file.Name(), path)
}

func (f *liveFixture) persistAuthentication() error {
	for _, name := range []string{"webauthn.json"} {
		body, err := os.ReadFile(filepath.Join(f.auth, "auth", "kogakuin", name))
		if os.IsNotExist(err) {
			continue
		}
		if err != nil {
			return err
		}
		if err := replaceAuthentication(filepath.Join(f.source, name), body); err != nil {
			return err
		}
	}
	return nil
}

func (f *liveFixture) run(t *testing.T, name string, use func(*testing.T, context.Context)) {
	t.Helper()
	t.Run(name, func(t *testing.T) {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
		defer cancel()
		t.Cleanup(func() {
			if err := f.persistAuthentication(); err != nil {
				t.Fatal("persist live authentication counters", err)
			}
		})
		use(t, ctx)
	})
}

func (f *liveFixture) availableCourse(t *testing.T, ctx context.Context) domain.Course {
	t.Helper()
	for _, course := range f.courseList(t, ctx) {
		if course.Availability == "available" {
			return course
		}
	}
	t.Skip("no available courses")
	return domain.Course{}
}

func (f *liveFixture) courseList(t *testing.T, ctx context.Context) []domain.Course {
	t.Helper()
	if f.courses == nil {
		var err error
		var listing domain.CourseListing
		listing, err = f.browser.Courses(ctx)
		f.courses = listing.Courses
		if err != nil {
			t.Fatal("read course list", err)
		}
	}
	return f.courses
}

type liveResource struct{ course, material, id string }

func (f *liveFixture) resource(t *testing.T, ctx context.Context, kind string) (liveResource, domain.Snapshot) {
	t.Helper()
	for _, course := range f.courseList(t, ctx) {
		if course.Availability != "available" {
			continue
		}
		materials, ok := f.materials[course.ID]
		if !ok {
			var err error
			materials, err = f.browser.Materials(ctx, course.ID)
			if err != nil {
				t.Fatal("find published materials", err)
			}
			if materials.Materials == nil {
				t.Fatal("missing material list")
			}
			f.materials[course.ID] = materials
		}
		for _, folder := range materials.Materials.Folders {
			for _, material := range folder.Materials {
				if material.Type != "material" || material.ResourceAvailability != "available" {
					continue
				}
				key := course.ID + "/" + material.ID
				resources, ok := f.resources[key]
				if !ok {
					var err error
					resources, err = f.browser.Resources(ctx, material.ID, course.ID)
					if err != nil {
						t.Fatal("find resources", err)
					}
					f.resources[key] = resources
				}
				for _, resource := range resources.Resources {
					if kind == "" || resource.Type == kind {
						return liveResource{course.ID, material.ID, resource.ID}, resources
					}
				}
			}
		}
	}
	t.Skip("no published resource for this operation")
	return liveResource{}, domain.Snapshot{}
}

func requireReason(t *testing.T, err error, reason string) {
	t.Helper()
	var failure *domain.Error
	if !errors.As(err, &failure) || failure.Reason != reason {
		t.Fatal("unexpected operation result", err)
	}
}

func TestLiveAuthenticationCopiesRetainCountersAfterWebAuthnDeletion(t *testing.T) {
	f := &liveFixture{source: t.TempDir(), auth: t.TempDir(), downloads: t.TempDir()}
	initial := []byte(`{"version":1,"username":"fixture@example.invalid","credentials":[{"signCount":1}]}`)
	updated := []byte(`{"version":1,"username":"fixture@example.invalid","credentials":[{"signCount":2}]}`)
	if err := os.MkdirAll(filepath.Join(f.auth, "auth", "kogakuin"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := replaceAuthentication(filepath.Join(f.source, "webauthn.json"), initial); err != nil {
		t.Fatal(err)
	}
	if err := replaceAuthentication(filepath.Join(f.auth, "auth", "kogakuin", "webauthn.json"), updated); err != nil {
		t.Fatal(err)
	}
	if err := f.persistAuthentication(); err != nil {
		t.Fatal(err)
	}
	b, err := adapter.New(adapter.Options{
		StateDir: f.auth, CacheDir: t.TempDir(), DownloadDir: f.downloads,
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { b.Close() })
	if err := b.DeleteWebAuthn(context.Background()); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(f.auth, "auth", "kogakuin", "webauthn.json")); !os.IsNotExist(err) {
		t.Fatal("test key retained after deletion", err)
	}
	actual, err := os.ReadFile(filepath.Join(f.source, "webauthn.json"))
	if err != nil || !bytes.Equal(actual, updated) {
		t.Fatal("original key and updated signature counter lost after deletion", err)
	}
}
