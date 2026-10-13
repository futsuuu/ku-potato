package tests

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	adapter "github.com/futsuuu/ku-potato/server/chromedp"
)

func chrome(t *testing.T) string {
	t.Helper()
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
func TestBrowserAgainstLocalLMS(t *testing.T) {
	executable := chrome(t)
	portal := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { fmt.Fprint(w, "<p>Authentication required</p>") }))
	defer portal.Close()
	var allowed atomic.Bool
	allowed.Store(true)
	var materialMalformed atomic.Bool
	var materialPrivate atomic.Bool
	var materialRemoved atomic.Bool
	var requireHomeToken atomic.Bool
	lms := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		switch r.URL.Path {
		case "/lms/homeRedirect/":
			cookie, err := r.Cookie("session")
			if err == nil && cookie.Value == "ok" && (!requireHomeToken.Load() || r.URL.Query().Get("sid") == "fixture") {
				http.Redirect(w, r, "/lms/homeHoml/doIndex", 302)
				return
			}
			http.Redirect(w, r, "/lms/error/notLogin", 302)
		case "/lms/error/notLogin":
			w.WriteHeader(http.StatusUnauthorized)
			fmt.Fprint(w, "<p>Not logged in</p>")
		case "/lms":
			fmt.Fprint(w, `<p>統合認証アカウントでログインします</p><form action="/login"><button name="loginButton">Login</button></form>`)
		case "/login":
			if allowed.Load() {
				http.SetCookie(w, &http.Cookie{Name: "session", Value: "ok", Path: "/", MaxAge: 3600})
				http.Redirect(w, r, "/lms/homeHoml/doIndex", 302)
			} else {
				http.Redirect(w, r, portal.URL+"/pub/login.cgi", 302)
			}
		case "/lms/homeHoml/doIndex":
			fmt.Fprint(w, `<a href="/lms/homeRedirect/?sid=fixture">HOME</a>`)
			fmt.Fprint(w, `<span class="lms-search-condition-title">講義一覧</span><select name="nendo"><option value="2026" selected>2026</option></select><div class="lms-weekly-area"><div class="lms-daybox"><div class="lms-category-title">月曜日</div><div class="lms-flex-container"><div class="lms-card"><div class="courseCardInfo">2限<span class="term">1Q～3Q</span></div><div class="lms-cardcontents"><div class="lms-cardname"><a onclick="formSubmit('KOG1')" href="/lms/homeHoml/doLinkKougi">Course</a></div></div></div>`)
			w.(http.Flusher).Flush()
			select {
			case <-time.After(300 * time.Millisecond):
			case <-r.Context().Done():
				return
			}
			fmt.Fprint(w, `<div class="lms-card"><div class="courseCardInfo">3限<span class="term">前期</span></div><div class="lms-cardcontents"><div class="lms-cardname">Unavailable course</div></div></div></div></div>
<div class="lms-daybox"><div class="lms-category-title">その他</div><div class="lms-flex-container"><div class="lms-card"><div class="courseCardInfo"><span class="term">その他</span></div><div class="lms-cardcontents"><div class="lms-cardname"><a onclick="formSubmit('KOG2')" href="/lms/homeHoml/doLinkKougi">Other course</a></div></div></div></div></div>
<div class="lms-daybox"><div class="lms-category-title">金曜日</div><div class="lms-flex-container"><div class="lms-card"><div class="courseCardInfo">6限<span class="term">後期</span></div><div class="lms-cardcontents"><div class="lms-cardname"><a onclick="formSubmit('KOG1')" href="/lms/homeHoml/doLinkKougi">Course</a></div></div></div></div></div>
</div><script>function formSubmit(){}</script>`)
		case "/lms/homeHoml/doLinkKougi":
			requireHomeToken.Store(true)
			// Navigation exposes the new URL before the document body is parsed.
			fmt.Fprint(w, "<!doctype html><html><head><meta charset='utf-8'>")
			w.(http.Flusher).Flush()
			select {
			case <-time.After(300 * time.Millisecond):
			case <-r.Context().Done():
				return
			}
			fmt.Fprint(w, "</head><body>")
			fmt.Fprint(w, `<a href="/lms/homeRedirect/?sid=fixture">HOME</a>`)
			if materialMalformed.Load() {
				fmt.Fprint(w, "<p>Unexpected page</p>")
				return
			}
			fmt.Fprint(w, `<table><tr><th>授業実施日</th></tr><tr class="accordionHeader"><td class="courseFolderName">Week 1</td><td class="checkStBoldJyugyoDy">2026/10/05</td></tr>`)
			w.(http.Flusher).Flush()
			select {
			case <-time.After(300 * time.Millisecond):
			case <-r.Context().Done():
				return
			}
			fmt.Fprint(w, `<tr><td><table>`)
			if !materialRemoved.Load() {
				if materialPrivate.Load() {
					fmt.Fprint(w, `<tr><td class="kyozaititleCell" id="SRY1"><i title="資料"></i>Handout</td><td>公開終了</td></tr>`)
				} else {
					fmt.Fprint(w, `<tr><td class="kyozaititleCell" id="SRY1"><i title="資料"></i><a href="/lms/corsColl/doLinkKyozaiTitle">Handout</a></td><td>2026/10/31 24:00</td></tr>`)
				}
			}
			fmt.Fprint(w, `<tr><td class="kyozaititleCell" id="REP1"><i title="レポート"></i>Report</td><td>－</td></tr></table></td></tr></table>`)
		case "/lms/corsColl/doLinkKyozaiTitle":
			fmt.Fprint(w, `<a href="/lms/homeRedirect/?sid=fixture">HOME</a>`)
			fmt.Fprint(w, `<table><tr><th>資料名</th></tr><tr><td data-label="資料名"><i title="ファイル資料"></i><a href="javascript:downloadFile('FIL1','SRS1')">handout.txt</a></td></tr><tr><td data-label="資料名"><i title="外部資料"></i><a href="/external?syosaiId=SRS2&amp;fileurl=https%3A%2F%2Fexample.org%2Fresource%23anchor">External</a></td></tr></table><script>function downloadFile(){location.href='/file'}</script>`)
		case "/file":
			w.Header().Set("Content-Type", "application/octet-stream")
			w.Header().Set("Content-Disposition", `attachment; filename="handout.txt"`)
			fmt.Fprint(w, "fixture file")
		default:
			http.NotFound(w, r)
		}
	}))
	defer lms.Close()
	data := t.TempDir()
	downloadDir := filepath.Join(t.TempDir(), "downloads")
	browser, err := adapter.New(adapter.Options{StateDir: data, CacheDir: filepath.Join(t.TempDir(), "cache"), DownloadDir: downloadDir, Executable: executable, LMSURL: lms.URL, PortalURL: portal.URL, Parallelism: 1})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { browser.Close() })
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	if err = browser.Login(ctx, false); err != nil {
		t.Fatal("login", err)
	}
	allowed.Store(false)
	courses, err := browser.Courses(ctx)
	if err != nil || len(courses.Courses) != 4 || courses.Courses[0].ID != "KOG1" {
		t.Fatal("persistent authentication", courses, err)
	}
	for i, want := range []struct {
		kind            string
		weekday, period int64
	}{{"scheduled", 1, 2}, {"scheduled", 1, 3}, {"other", 0, 0}, {"scheduled", 5, 6}} {
		course := courses.Courses[i]
		if courses.AcademicYear != 2026 || course.AcademicYear != 2026 || course.Type != want.kind {
			t.Fatalf("course %d: incorrect year or kind: %+v", i, course)
		}
		if want.kind == "other" {
			if course.Weekday != nil || course.Period != nil {
				t.Fatal("other course retained a schedule", course)
			}
		} else if course.Weekday == nil || course.Period == nil || *course.Weekday != want.weekday || *course.Period != want.period {
			t.Fatalf("course %d: incorrect schedule: %+v", i, course)
		}
	}
	if courses.Courses[1].Availability != "unavailable" || courses.Courses[3].ID != "KOG1" {
		t.Fatal("unavailable or duplicate course placement was lost", courses)
	}
	materials, err := browser.Materials(ctx, "KOG1")
	if err != nil {
		t.Fatal("materials", err)
	}
	if len(materials.Materials.Folders) != 1 || materials.Materials.Folders[0].Materials[0].PublicationDeadline != "2026-10-31T15:00:00Z" {
		t.Fatal(materials)
	}
	resources, err := browser.Resources(ctx, "SRY1", "KOG1")
	if err != nil || len(resources.Resources) != 2 || resources.Resources[0].ID != "SRS1" {
		t.Fatal("resources", resources, err)
	}
	download, err := browser.Download(ctx, "SRY1", "SRS1", "KOG1")
	if err != nil {
		t.Fatal("download", err)
	}
	if filepath.Dir(download.Path) != downloadDir {
		t.Fatalf("download stored outside configured temporary directory: %s", download.Path)
	}
	body, err := os.ReadFile(download.Path)
	if err != nil || string(body) != "fixture file" || download.Filename != "handout.txt" {
		t.Fatal(string(body), download, err)
	}
	os.Remove(download.Path)
	external, err := browser.Download(ctx, "SRY1", "SRS2", "KOG1")
	if err != nil || external.URL != "https://example.org/resource#anchor" {
		t.Fatal(external, err)
	}
	materialPrivate.Store(true)
	private, err := browser.Resources(ctx, "SRY1", "KOG1")
	if err != nil || private.Resources != nil || private.Materials == nil || private.Materials.Folders[0].Materials[0].ResourceAvailability != "unavailable" {
		t.Fatal("private material must not become a fetched empty list", private, err)
	}
	materialRemoved.Store(true)
	removed, err := browser.Resources(ctx, "SRY1", "KOG1")
	if err != nil || removed.Resources != nil || removed.Materials == nil || len(removed.Materials.Folders[0].Materials) != 1 {
		t.Fatal("removed material must keep the latest listing observation", removed, err)
	}
	materialMalformed.Store(true)
	short, stop := context.WithTimeout(ctx, 3*time.Second)
	_, err = browser.Materials(short, "KOG1")
	stop()
	if err == nil {
		t.Fatal("accepted malformed page as empty")
	}
}
