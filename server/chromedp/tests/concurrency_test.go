package tests

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	adapter "github.com/futsuuu/ku-potato/server/chromedp"
)

func TestParallelLMSOperationsKeepSessionsAndDownloadsSeparate(t *testing.T) {
	executable := chrome(t)
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	var sessions atomic.Int32
	var initialLogin atomic.Bool
	var ssoVersion atomic.Int32
	initialLogin.Store(true)
	var mu sync.Mutex
	selected := map[string]string{}
	// Both operations must reach the same endpoint before either may continue.
	arrivals := make(chan string, 2)
	type rendezvous struct {
		path    string
		release chan struct{}
	}
	var barrier atomic.Pointer[rendezvous]
	wait := func(r *http.Request, session string) bool {
		if pending := barrier.Load(); pending != nil && pending.path == r.URL.Path {
			select {
			case arrivals <- session:
			case <-r.Context().Done():
				return false
			}
			select {
			case <-pending.release:
			case <-r.Context().Done():
				return false
			}
		}
		return true
	}
	var lmsAddress atomic.Value
	portal := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		cookie, err := r.Cookie("sso")
		if (err != nil || cookie.Value != fmt.Sprint(ssoVersion.Load())) && !initialLogin.Load() {
			http.Error(w, "SSO state missing", http.StatusUnauthorized)
			return
		}
		// A successful SSO handoff rotates the token and invalidates its old value.
		http.SetCookie(w, &http.Cookie{Name: "sso", Value: fmt.Sprint(ssoVersion.Add(1)), Path: "/", MaxAge: 3600})
		http.Redirect(w, r, lmsAddress.Load().(string)+"/ticket", 302)
	}))
	defer portal.Close()
	// Distinct hosts model the portal and LMS cookie boundaries.
	portalURL := strings.Replace(portal.URL, "127.0.0.1", "localhost", 1)
	lms := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		cookie, _ := r.Cookie("lms-session")
		session := ""
		if cookie != nil {
			session = cookie.Value
		}
		switch r.URL.Path {
		case "/ticket":
			session = fmt.Sprint(sessions.Add(1))
			http.SetCookie(w, &http.Cookie{Name: "lms-session", Value: session, Path: "/", MaxAge: 3600})
			http.Redirect(w, r, "/lms/homeHoml/doIndex", 302)
		case "/lms/homeRedirect/":
			if session == "" {
				http.Redirect(w, r, "/lms", 302)
			} else {
				http.Redirect(w, r, "/lms/homeHoml/doIndex", 302)
			}
		case "/lms":
			fmt.Fprintf(w, `<p>統合認証アカウントでログインします</p><form action="%s"><button name="loginButton">Login</button></form>`, portalURL)
		case "/lms/homeHoml/doIndex":
			fmt.Fprint(w, `<span class="lms-search-condition-title">講義一覧</span><select name="nendo"><option value="2026" selected>2026</option></select><div class="lms-weekly-area"><div class="lms-cardname"><a onclick="formSubmit('KOG1')">Course 1</a></div><div class="lms-cardname"><a onclick="formSubmit('KOG2')">Course 2</a></div></div><script>function formSubmit(id){location.href='/lms/homeHoml/doLinkKougi?id='+id}</script>`)
		case "/lms/homeHoml/doLinkKougi":
			mu.Lock()
			selected[session] = r.URL.Query().Get("id")
			mu.Unlock()
			if !wait(r, session) {
				return
			}
			mu.Lock()
			course := selected[session]
			mu.Unlock()
			n := strings.TrimPrefix(course, "KOG")
			fmt.Fprintf(w, `<table><tr><th>授業実施日</th></tr><tr class="accordionHeader"><td class="courseFolderName">%s</td><td class="checkStBoldJyugyoDy">2026/10/05</td></tr><tr><td><table><tr><td class="kyozaititleCell" id="SRY%s"><i title="資料"></i><a href="/lms/corsColl/doLinkKyozaiTitle">Handout</a></td><td>－</td></tr></table></td></tr></table>`, course, n)
		case "/lms/corsColl/doLinkKyozaiTitle":
			mu.Lock()
			course := selected[session]
			mu.Unlock()
			n := strings.TrimPrefix(course, "KOG")
			fmt.Fprintf(w, `<table><tr><th>資料名</th></tr><tr><td data-label="資料名"><i title="ファイル資料"></i><a href="javascript:downloadFile('FIL%s','SRS%s')">%s.txt</a></td></tr></table><script>function downloadFile(){location.href='/file'}</script>`, n, n, course)
		case "/file":
			if !wait(r, session) {
				return
			}
			mu.Lock()
			course := selected[session]
			mu.Unlock()
			w.Header().Set("Content-Type", "application/octet-stream")
			w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s.txt"`, course))
			fmt.Fprint(w, course)
		default:
			http.NotFound(w, r)
		}
	}))
	defer lms.Close()
	lmsAddress.Store(lms.URL)
	dir := t.TempDir()
	b, err := adapter.New(adapter.Options{StateDir: filepath.Join(dir, "state"), CacheDir: filepath.Join(dir, "cache"), DownloadDir: filepath.Join(dir, "downloads"), Executable: executable, LMSURL: lms.URL, PortalURL: portalURL, Parallelism: 2})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { b.Close() })
	if err = b.Login(ctx, false); err != nil {
		t.Fatal(err)
	}
	initialLogin.Store(false)
	parallel := func(path string, use func(int) error) {
		t.Helper()
		release := make(chan struct{})
		barrier.Store(&rendezvous{path: path, release: release})
		done := make(chan error, 2)
		for i := 1; i <= 2; i++ {
			go func() { done <- use(i) }()
		}
		seen := map[string]bool{}
		for range 2 {
			select {
			case session := <-arrivals:
				seen[session] = true
			case err := <-done:
				close(release)
				t.Fatalf("operation ended before concurrent access: %v", err)
			case <-ctx.Done():
				close(release)
				t.Fatal("operations did not overlap", ctx.Err())
			}
		}
		if len(seen) != 2 || seen[""] || seen["1"] {
			t.Errorf("operations share each other or the default LMS session: %v", seen)
		}
		// Subsequent endpoints in these operations should run without a barrier.
		barrier.Store(nil)
		close(release)
		for range 2 {
			if err := <-done; err != nil {
				t.Fatal(err)
			}
		}
	}
	parallel("/lms/homeHoml/doLinkKougi", func(i int) error {
		course := fmt.Sprintf("KOG%d", i)
		snapshot, err := b.Materials(ctx, course)
		if err != nil {
			return err
		}
		if snapshot.Materials.Folders[0].Name != course {
			return fmt.Errorf("selected course leaked between sessions")
		}
		return nil
	})
	// Hold both file responses so the downloads overlap; browser-wide events
	// must still be attributed to their own page.
	paths := make(chan string, 2)
	parallel("/file", func(i int) error {
		course := fmt.Sprintf("KOG%d", i)
		download, err := b.Download(ctx, fmt.Sprintf("SRY%d", i), fmt.Sprintf("SRS%d", i), course, "")
		if err != nil {
			return err
		}
		body, err := os.ReadFile(download.Path)
		if err != nil {
			return err
		}
		if string(body) != course || download.Filename != course+".txt" {
			return fmt.Errorf("download received another page's file: %s / %s", body, download.Filename)
		}
		paths <- download.Path
		return nil
	})
	first, second := <-paths, <-paths
	if first == second {
		t.Fatal("downloads share a temporary file")
	}
	if sessions.Load() != 3 {
		t.Fatalf("created %d LMS sessions; want root plus two reusable contexts", sessions.Load())
	}
}
