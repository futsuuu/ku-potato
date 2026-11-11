package browserworker

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/futsuuu/ku-potato/app-server/userbrowser"
)

func TestIndependentWorkerReceivesSSOCookiesAndCreatesLMSOwnSession(t *testing.T) {
	chrome, err := exec.LookPath("google-chrome")
	if err != nil {
		chrome, err = exec.LookPath("chromium")
		if err != nil {
			chrome = `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`
			if _, err := os.Stat(chrome); err != nil {
				t.Skip("Chrome unavailable")
			}
		}
	}
	root := t.TempDir()
	binary := filepath.Join(root, "ku-potato-browser-worker")
	if runtime.GOOS == "windows" {
		binary += ".exe"
	}
	build := exec.Command(
		"go",
		"build",
		"-o",
		binary,
		"./browser-worker/cmd/ku-potato-browser-worker",
	)
	build.Dir = "../.."
	if output, err := build.CombinedOutput(); err != nil {
		t.Fatalf("build worker: %v\n%s", err, output)
	}
	authBinary := filepath.Join(root, "ku-potato-user-browser")
	if runtime.GOOS == "windows" {
		authBinary += ".exe"
	}
	build = exec.Command(
		"go",
		"build",
		"-o",
		authBinary,
		"./user-browser/cmd/ku-potato-user-browser",
	)
	build.Dir = "../.."
	if output, err := build.CombinedOutput(); err != nil {
		t.Fatalf("build user browser: %v\n%s", err, output)
	}
	var lmsAddress atomic.Value
	var grant atomic.Bool
	grant.Store(true)
	sso := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		cookie, err := r.Cookie("sso")
		if (err != nil || cookie.Value != "valid") && !grant.Swap(false) {
			http.Error(w, "SSO session missing", http.StatusUnauthorized)
			return
		}
		http.SetCookie(w, &http.Cookie{Name: "sso", Value: "valid", Path: "/", MaxAge: 3600})
		http.Redirect(w, r, lmsAddress.Load().(string)+"/ticket", http.StatusFound)
	}))
	defer sso.Close()
	ssoURL := strings.Replace(sso.URL, "127.0.0.1", "localhost", 1)
	var sessions atomic.Int32
	lms := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		cookie, _ := r.Cookie("lms-session")
		session := cookie != nil && cookie.Value != ""
		switch r.URL.Path {
		case "/ticket":
			http.SetCookie(
				w,
				&http.Cookie{
					Name:   "lms-session",
					Value:  fmt.Sprint(sessions.Add(1)),
					Path:   "/",
					MaxAge: 3600,
				},
			)
			http.Redirect(w, r, "/lms/homeHoml/doIndex", http.StatusFound)
		case "/lms/homeRedirect/":
			if session {
				http.Redirect(w, r, "/lms/homeHoml/doIndex", http.StatusFound)
			} else {
				http.Redirect(w, r, "/lms/error/notLogin", http.StatusFound)
			}
		case "/lms/error/notLogin":
			w.WriteHeader(http.StatusUnauthorized)
			fmt.Fprint(w, "Not logged in")
		case "/lms":
			fmt.Fprintf(
				w,
				`<p>統合認証アカウントでログインします</p><form action="%s"><button name="loginButton">Login</button></form>`,
				ssoURL,
			)
		case "/lms/homeHoml/doIndex":
			if !session {
				http.Redirect(w, r, "/lms/error/notLogin", http.StatusFound)
				return
			}
			fmt.Fprint(
				w,
				`<span class="lms-search-condition-title">講義一覧</span><select name="nendo"><option value="2026" selected>2026</option></select><div class="lms-weekly-area"><div class="lms-cardname"><a onclick="formSubmit('KOG1')">Course</a></div></div>`,
			)
		default:
			http.NotFound(w, r)
		}
	}))
	defer lms.Close()
	lmsAddress.Store(lms.URL)
	ctx, cancel := context.WithTimeout(context.Background(), 75*time.Second)
	defer cancel()
	authBrowser, err := userbrowser.Start(ctx, authBinary,
		filepath.Join(root, "state"), filepath.Join(root, "auth-cache"), chrome, lms.URL, ssoURL)
	if err != nil {
		t.Fatal(err)
	}
	defer func(process *userbrowser.Process) { _ = process.Close() }(authBrowser)
	auth := userbrowser.NewLMS(authBrowser.Client)
	if err = auth.Login(ctx, false); err != nil {
		t.Fatal("authenticate original profile", err)
	}
	// A clean subprocess shutdown must flush the same persistent profile.
	if err := authBrowser.Close(); err != nil {
		t.Fatal(err)
	}
	authBrowser, err = userbrowser.Start(ctx, authBinary,
		filepath.Join(root, "state"), filepath.Join(root, "auth-cache"), chrome, lms.URL, ssoURL)
	if err != nil {
		t.Fatal(err)
	}
	defer func(process *userbrowser.Process) { _ = process.Close() }(authBrowser)
	auth = userbrowser.NewLMS(authBrowser.Client)
	if ok, err := auth.Status(ctx); err != nil || !ok {
		t.Fatal("authentication lost after restart", ok, err)
	}
	worker, err := Start(ctx, binary, root, chrome, 1, lms.URL, ssoURL)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = worker.Close() }()
	client := New(worker.Client, auth, root)
	listing, err := client.Courses(ctx)
	if err != nil || listing.AcademicYear != 2026 || len(listing.Courses) != 1 ||
		listing.Courses[0].ID != "KOG1" {
		t.Fatalf("worker could not read courses: %+v %v", listing, err)
	}
	if sessions.Load() != 2 {
		t.Fatalf("browser sessions were shared or not established: %d", sessions.Load())
	}
	if _, err := os.Stat(
		filepath.Join(root, "state", "auth", "kogakuin", "webauthn.json"),
	); !os.IsNotExist(err) {
		t.Fatal("fixture unexpectedly created a credential")
	}
}
