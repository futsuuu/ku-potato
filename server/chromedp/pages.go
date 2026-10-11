package chromedp

import (
	"context"
	_ "embed"
	"fmt"
	"log/slog"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	cd "github.com/chromedp/chromedp"
	"github.com/futsuuu/ku-potato/server/domain"
)

//go:embed courses.js
var coursesJS string

//go:embed materials.js
var materialsJS string

//go:embed resources.js
var resourcesJS string

var courseHandler = regexp.MustCompile(`\bformSubmit\(\s*["']([^"']+)["']`)
var coursePeriod = regexp.MustCompile(`^([1-9][0-9]*)限$`)
var materialIdentity = regexp.MustCompile(`^[A-Z]+\d+$`)
var resourceIdentity = regexp.MustCompile(`^SRS\d+$`)
var fileHandler = regexp.MustCompile(`downloadFile\s*\(\s*['"][^'"]*['"]\s*,\s*['"]([^'"]*)['"]`)
var windowHandler = regexp.MustCompile(`openWindow\s*\(\s*['"]([^'"]+)['"]`)
var unknownHandler = regexp.MustCompile(`['"](SRS\d+)['"]`)

func (b *Browser) readCourses(ctx context.Context) (domain.CourseListing, error) {
	listing := domain.CourseListing{}
	if err := poll(ctx, b.homeExpression()); err != nil {
		return listing, err
	}
	if err := cd.Run(ctx, cd.Evaluate(`Number(document.querySelector('select[name="nendo"]')?.value || 0)`, &listing.AcademicYear)); err != nil {
		return listing, err
	}
	if listing.AcademicYear < 1 || listing.AcademicYear > 9999 {
		return listing, domain.Fail("source", "HOMEの選択年度を取得できません。")
	}
	var entries []struct {
		Name             string
		Handler          *string
		Linked           bool
		Category, Period string
	}
	if err := cd.Run(ctx, cd.Evaluate(coursesJS, &entries)); err != nil {
		return listing, err
	}
	courses := []domain.Course{}
	for _, entry := range entries {
		c := domain.Course{Name: entry.Name, Availability: "unavailable", AcademicYear: listing.AcademicYear, Type: "unknown"}
		if entry.Linked {
			if entry.Handler == nil {
				return listing, domain.Fail("source", "講義リンクのIDがありません。")
			}
			match := courseHandler.FindStringSubmatch(*entry.Handler)
			if match == nil {
				return listing, domain.Fail("source", "講義IDが不正です。")
			}
			c.ID = match[1]
			c.Availability = "available"
		}
		kind, weekday, period, err := parseCourseSchedule(entry.Category, entry.Period)
		if err != nil {
			slog.Error("unrecognized LMS value", "id", c.ID, "field", "schedule", "category", entry.Category, "period", entry.Period)
		}
		c.Type, c.Weekday, c.Period = kind, weekday, period
		courses = append(courses, c)
	}
	listing.Courses = courses
	return listing, nil
}

func parseCourseSchedule(category, period string) (string, *int64, *int64, error) {
	if category == "その他" {
		return "other", nil, nil, nil
	}
	weekday := int64(0)
	for i, name := range []string{"月曜日", "火曜日", "水曜日", "木曜日", "金曜日", "土曜日", "日曜日"} {
		if category == name {
			weekday = int64(i + 1)
			break
		}
	}
	match := coursePeriod.FindStringSubmatch(period)
	if weekday != 0 && match != nil {
		if value, err := strconv.ParseInt(match[1], 10, 64); err == nil {
			return "scheduled", &weekday, &value, nil
		}
	}
	return "unknown", nil, nil, fmt.Errorf("unrecognized course schedule")
}
func (b *Browser) openCourse(ctx context.Context, id string) error {
	var clicked bool
	expression := `(()=>{const id=` + js(id) + `;const a=[...document.querySelectorAll('.lms-weekly-area .lms-cardname a')].find(a=>{const m=(a.getAttribute('onclick')||'').match(/\bformSubmit\(\s*["']([^"']+)["']/);return m&&m[1]===id});if(!a)return false;a.click();return true})()`
	if err := cd.Run(ctx, cd.Evaluate(expression, &clicked)); err != nil {
		return err
	}
	if !clicked {
		return domain.Fail("course-not-found", "講義が現在のLMS一覧にありません。")
	}
	return poll(ctx, `document.readyState==='complete' && location.origin===`+js(b.opts.LMSURL)+` && /^\/lms\/(?:homeHoml\/doLinkKougi|corsColl\/doIndex)(?:;|$)/.test(location.pathname) && ([...document.querySelectorAll('th')].some(e=>e.textContent.trim()==='授業実施日') && !!document.querySelector('.courseFolderName') || !!document.body?.innerText.includes('授業が登録されていません。'))`)
}

type rawMaterial struct {
	ID, Name, Type, Deadline string
	Linked                   bool
}
type rawFolder struct {
	Name, Date string
	Materials  []rawMaterial
}

func (b *Browser) readMaterials(ctx context.Context, id string) (domain.CourseMaterials, error) {
	var folders []rawFolder
	if err := cd.Run(ctx, cd.Evaluate(materialsJS, &folders)); err != nil {
		return domain.CourseMaterials{}, err
	}
	result := domain.CourseMaterials{CourseID: id, Folders: []domain.Folder{}}
	seen := map[string]bool{}
	for _, raw := range folders {
		date, err := parseCalendarDate(raw.Date)
		if err != nil {
			slog.Error("unrecognized LMS value", "id", id, "field", "class_date", "value", raw.Date)
		}
		folder := domain.Folder{Name: raw.Name, ClassDate: date, Materials: []domain.Material{}}
		for _, entry := range raw.Materials {
			if !materialIdentity.MatchString(entry.ID) || seen[entry.ID] {
				return result, domain.Fail("source", "教材IDが不正または重複しています。")
			}
			seen[entry.ID] = true
			kind, err := parseType(entry.Type)
			if err != nil {
				slog.Error("unrecognized LMS value", "id", entry.ID, "field", "type", "value", entry.Type)
				kind = "unknown"
			}
			deadline, err := parseDeadline(entry.Deadline)
			if err != nil {
				slog.Error("unrecognized LMS value", "id", entry.ID, "field", "publication_deadline", "value", entry.Deadline)
				deadline = "unknown"
			}
			m := domain.Material{ID: entry.ID, Name: entry.Name, Type: kind, PublicationDeadline: deadline, Status: "unknown", MaterialLinkAvailable: entry.Linked}
			if kind == "material" {
				m.ResourceAvailability = "unavailable"
				if entry.Linked {
					m.ResourceAvailability = "available"
				}
			}
			folder.Materials = append(folder.Materials, m)
		}
		result.Folders = append(result.Folders, folder)
	}
	return result, nil
}
func parseType(raw string) (string, error) {
	switch raw {
	case "Materials", "資料":
		return "material", nil
	case "e-Learning", "e-learning":
		return "e-learning", nil
	case "Report", "レポート":
		return "report", nil
	case "Test", "テスト":
		return "test", nil
	case "Questionnaire", "アンケート":
		return "questionnaire", nil
	case "Board", "掲示板":
		return "board", nil
	case "Feedback", "フィードバック":
		return "feedback", nil
	}
	return "", domain.Fail("source", "未対応の教材種別です。")
}
func optional(raw string) bool {
	return raw == "" || strings.Trim(raw, "-‐‑‒–—―－ ") == ""
}
func parseCalendarDate(raw string) (string, error) {
	if optional(raw) {
		return "", nil
	}
	for _, layout := range []string{"2006/01/02", "2006-01-02"} {
		if date, err := time.Parse(layout, raw); err == nil && date.Year() >= 1 {
			return date.Format("2006-01-02"), nil
		}
	}
	return "", domain.Fail("source", "LMSの日付を解析できません。")
}
func parseDate(raw string) (string, error) {
	if optional(raw) {
		return "", nil
	}
	// LMS represents the end of a publication day as 24:00. Validate the
	// original calendar date at midnight before advancing it by one day.
	endOfDay := strings.HasSuffix(raw, " 24:00") || strings.HasSuffix(raw, " 24:00:00")
	if endOfDay {
		raw = strings.Replace(raw, " 24:00", " 00:00", 1)
	}
	zone := time.FixedZone("JST", 9*60*60)
	for _, layout := range []string{"2006/01/02 15:04:05", "2006/01/02 15:04", "2006/01/02", "2006-01-02 15:04:05", "2006-01-02 15:04", "2006-01-02"} {
		if date, err := time.ParseInLocation(layout, raw, zone); err == nil {
			if endOfDay {
				date = date.AddDate(0, 0, 1)
			}
			return date.UTC().Format(time.RFC3339), nil
		}
	}
	return "", domain.Fail("source", "LMSの日付を解析できません。")
}
func parseDeadline(raw string) (string, error) {
	if raw == "公開終了" || raw == "Unavailable" {
		return "unavailable", nil
	}
	date, err := parseDate(raw)
	if date == "" && err == nil {
		return "no-deadline", nil
	}
	return date, err
}

type rawResource struct {
	Name, Kind string
	Handlers   []string
}

func (b *Browser) readResources(ctx context.Context) ([]domain.Resource, error) {
	var entries []rawResource
	if err := cd.Run(ctx, cd.Evaluate(resourcesJS, &entries)); err != nil {
		return nil, err
	}
	var pageURL string
	if err := cd.Run(ctx, cd.Location(&pageURL)); err != nil {
		return nil, err
	}
	base, err := url.Parse(pageURL)
	if err != nil {
		return nil, err
	}
	resources := []domain.Resource{}
	seen := map[string]bool{}
	for _, entry := range entries {
		r := domain.Resource{Name: entry.Name, Type: "unknown", Availability: "current", Status: "unknown"}
		for _, handler := range entry.Handlers {
			if match := fileHandler.FindStringSubmatch(handler); match != nil {
				r.ID = match[1]
			}
			candidate := handler
			if match := windowHandler.FindStringSubmatch(handler); match != nil {
				candidate = match[1]
			}
			if !strings.HasPrefix(candidate, "javascript:") {
				parsed, err := url.Parse(candidate)
				if err != nil {
					return nil, domain.Fail("source", "資料URLが不正です。")
				}
				parsed = base.ResolveReference(parsed)
				if r.ID == "" {
					r.ID = parsed.Query().Get("syosaiId")
				}
				if r.URL == "" {
					r.URL = parsed.Query().Get("fileurl")
				}
			}
			if r.ID == "" {
				if match := unknownHandler.FindStringSubmatch(handler); match != nil {
					r.ID = match[1]
				}
			}
		}
		if !resourceIdentity.MatchString(r.ID) || seen[r.ID] {
			return nil, domain.Fail("source", "資料IDが不正または重複しています。")
		}
		seen[r.ID] = true
		switch entry.Kind {
		case "ファイル資料":
			r.Type = "file"
		case "外部資料":
			r.Type = "external"
			if err := httpURL(r.URL); err != nil {
				return nil, err
			}
		default:
			slog.Error("unrecognized LMS value", "id", r.ID, "field", "type", "value", entry.Kind)
		}
		resources = append(resources, r)
	}
	return resources, nil
}
func httpURL(raw string) error {
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return domain.Fail("source", "外部資料URLはHTTP(S)である必要があります。")
	}
	return nil
}
func (b *Browser) materialSnapshot(ctx context.Context, material, preferred string) (domain.Snapshot, error) {
	courses, err := b.readCourses(ctx)
	if err != nil {
		return domain.Snapshot{}, err
	}
	ids := []string{}
	seenCourses := map[string]bool{}
	// Keep a successful listing observation even if a previously known material disappeared.
	missing := domain.Snapshot{AcademicYear: courses.AcademicYear, Courses: courses.Courses, MaterialID: material}
	for _, c := range courses.Courses {
		if c.ID == preferred && c.Availability == "available" && !seenCourses[c.ID] {
			seenCourses[c.ID] = true
			ids = append(ids, c.ID)
		}
	}
	for _, c := range courses.Courses {
		if c.ID != preferred && c.Availability == "available" && !seenCourses[c.ID] {
			seenCourses[c.ID] = true
			ids = append(ids, c.ID)
		}
	}
	for _, id := range ids {
		if err = b.home(ctx); err != nil {
			return domain.Snapshot{}, err
		}
		if err = b.openCourse(ctx, id); err != nil {
			return domain.Snapshot{}, err
		}
		materials, err := b.readMaterials(ctx, id)
		if err != nil {
			return domain.Snapshot{}, err
		}
		if id == preferred {
			missing.Materials = &materials
		}
		for _, folder := range materials.Folders {
			for _, m := range folder.Materials {
				if m.ID != material {
					continue
				}
				snapshot := domain.Snapshot{AcademicYear: courses.AcademicYear, Courses: courses.Courses, Materials: &materials, MaterialID: material}
				if m.Type != "material" || m.ResourceAvailability != "available" {
					return snapshot, nil
				}
				if err = cd.Run(ctx, cd.Evaluate(fmt.Sprintf(`document.querySelector('td.kyozaititleCell#%s a').click()`, material), nil)); err != nil {
					return snapshot, err
				}
				if err = poll(ctx, `location.origin===`+js(b.opts.LMSURL)+` && /^\/lms\/corsColl\/doLinkKyozaiTitle(?:;|$)/.test(location.pathname) && [...document.querySelectorAll('th')].some(e=>e.textContent.trim()==='資料名')`); err != nil {
					return snapshot, err
				}
				snapshot.Resources, err = b.readResources(ctx)
				return snapshot, err
			}
		}
	}
	if preferred != "" {
		return missing, nil
	}
	return domain.Snapshot{}, domain.Fail("material-not-found", "教材が現在のLMS一覧にありません。保存済みデータを参照してください。")
}
func (b *Browser) Courses(ctx context.Context) (courses domain.CourseListing, err error) {
	err = b.withPage(ctx, func(tab context.Context) error {
		var e error
		courses, e = b.readCourses(tab)
		return e
	})
	return
}
func (b *Browser) Materials(ctx context.Context, id string) (snapshot domain.Snapshot, err error) {
	err = b.withPage(ctx, func(tab context.Context) error {
		courses, e := b.readCourses(tab)
		if e != nil {
			return e
		}
		if e = b.openCourse(tab, id); e != nil {
			return e
		}
		materials, e := b.readMaterials(tab, id)
		snapshot = domain.Snapshot{AcademicYear: courses.AcademicYear, Courses: courses.Courses, Materials: &materials}
		return e
	})
	return
}
func (b *Browser) Resources(ctx context.Context, material, preferred string) (snapshot domain.Snapshot, err error) {
	err = b.withPage(ctx, func(tab context.Context) error {
		var e error
		snapshot, e = b.materialSnapshot(tab, material, preferred)
		return e
	})
	return
}
