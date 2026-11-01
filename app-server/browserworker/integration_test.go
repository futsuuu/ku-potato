package browserworker

import (
	"context"
	"fmt"
	"log/slog"
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

	chromedp "github.com/futsuuu/ku-potato/app-server/browserauth"
)

func TestIndependentWorkerReceivesSSOCookiesAndCreatesLMSOwnSession(t *testing.T) {
	chrome, err := exec.LookPath("google-chrome")
	if err != nil {
		chrome, err = exec.LookPath("chromium")
		if err != nil {
			t.Skip("Chrome unavailable")
		}
	}
	root := t.TempDir()
	binary := filepath.Join(root, "ku-potato-browser-worker")
	if runtime.GOOS == "windows" {
		binary += ".exe"
	}
	build := exec.Command("go", "build", "-o", binary, "./browser-worker/cmd/ku-potato-browser-worker")
	build.Dir = "../.."
	if output, err := build.CombinedOutput(); err != nil {
		t.Fatalf("build worker: %v\n%s", err, output)
	}
	var lmsAddress atomic.Value
	var grant atomic.Bool
	grant.Store(true)
	sso := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		cookie, err := r.Cookie("sso")
		if (err != nil || cookie.Value != "valid") && !grant.Swap(false) {
			http.Error(w, "SSO session missing", 401)
			return
		}
		http.SetCookie(w, &http.Cookie{Name: "sso", Value: "valid", Path: "/", MaxAge: 3600})
		http.Redirect(w, r, lmsAddress.Load().(string)+"/ticket", 302)
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
			http.SetCookie(w, &http.Cookie{Name: "lms-session", Value: fmt.Sprint(sessions.Add(1)), Path: "/", MaxAge: 3600})
			http.Redirect(w, r, "/lms/homeHoml/doIndex", 302)
		case "/lms/homeRedirect/":
			if session {
				http.Redirect(w, r, "/lms/homeHoml/doIndex", 302)
			} else {
				http.Redirect(w, r, "/lms/error/notLogin", 302)
			}
		case "/lms/error/notLogin":
			w.WriteHeader(401)
			fmt.Fprint(w, "Not logged in")
		case "/lms":
			fmt.Fprintf(w, `<p>統合認証アカウントでログインします</p><form action="%s"><button name="loginButton">Login</button></form>`, ssoURL)
		case "/lms/homeHoml/doIndex":
			if !session {
				http.Redirect(w, r, "/lms/error/notLogin", 302)
				return
			}
			fmt.Fprint(w, `<span class="lms-search-condition-title">講義一覧</span><select name="nendo"><option value="2026" selected>2026</option></select><div class="lms-weekly-area"><div class="lms-cardname"><a onclick="formSubmit('KOG1')">Course</a></div></div>`)
		default:
			http.NotFound(w, r)
		}
	}))
	defer lms.Close()
	lmsAddress.Store(lms.URL)
	ctx, cancel := context.WithTimeout(context.Background(), 75*time.Second)
	defer cancel()
	authBrowser, err := chromedp.New(chromedp.Options{
		StateDir: filepath.Join(root, "state"), ProfileDir: filepath.Join(root, "auth-profile"),
		CacheDir: filepath.Join(root, "auth-cache"), Executable: chrome,
		LMSURL: lms.URL, SSOURL: ssoURL,
		Logger: slog.New(slog.NewTextHandler(t.Output(), nil)),
	})
	if err != nil {
		t.Fatal(err)
	}
	defer authBrowser.Close()
	auth := chromedp.NewLMSAuthenticator(authBrowser)
	if err = auth.Login(ctx, false); err != nil {
		t.Fatal("authenticate original profile", err)
	}
	worker, err := Start(ctx, binary, root, chrome, 1, lms.URL, ssoURL)
	if err != nil {
		t.Fatal(err)
	}
	defer worker.Close()
	client := New(worker.Client, auth, root)
	listing, err := client.Courses(ctx)
	if err != nil || listing.AcademicYear != 2026 || len(listing.Courses) != 1 || listing.Courses[0].ID != "KOG1" {
		t.Fatalf("worker could not read courses: %+v %v", listing, err)
	}
	if sessions.Load() != 2 {
		t.Fatalf("browser sessions were shared or not established: %d", sessions.Load())
	}
	if _, err := os.Stat(filepath.Join(root, "state", "auth", "kogakuin", "webauthn.json")); !os.IsNotExist(err) {
		t.Fatal("fixture unexpectedly created a credential")
	}
}
