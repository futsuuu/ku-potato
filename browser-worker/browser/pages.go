package browser

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
	workerproto "github.com/futsuuu/ku-potato/browser-worker/protocol"
)

//go:embed courses.js
var coursesJS string

//go:embed materials.js
var materialsJS string

//go:embed resources.js
var resourcesJS string

var (
	courseHandler  = regexp.MustCompile(`\bformSubmit\(\s*["']([^"']+)["']`)
	coursePeriod   = regexp.MustCompile(`^([1-9][0-9]*)限$`)
	fileHandler    = regexp.MustCompile(`downloadFile\s*\(\s*['"][^'"]*['"]\s*,\s*['"]([^'"]*)['"]`)
	windowHandler  = regexp.MustCompile(`openWindow\s*\(\s*['"]([^'"]+)['"]`)
	unknownHandler = regexp.MustCompile(`['"](SRS\d+)['"]`)
)

func (b *Browser) readCourses(ctx context.Context) (*workerproto.CourseListing, error) {
	if err := poll(ctx, b.homeExpression()); err != nil {
		return nil, err
	}
	var year int
	if err := cd.Run(
		ctx,
		cd.Evaluate(`Number(document.querySelector('select[name="nendo"]')?.value || 0)`, &year),
	); err != nil {
		return nil, err
	}
	if year < 1 || year > 9999 {
		return nil, Fail(workerproto.FailureReason_FAILURE_REASON_SOURCE, "HOMEの選択年度を取得できません。")
	}
	var entries []struct {
		Name             string
		Handler          *string
		Linked           bool
		Category, Period string
	}
	if err := cd.Run(ctx, cd.Evaluate(coursesJS, &entries)); err != nil {
		return nil, err
	}
	listing := &workerproto.CourseListing{
		AcademicYear: int32(year),
		Courses:      []*workerproto.Course{},
	}
	for _, entry := range entries {
		id := ""
		if entry.Linked {
			if entry.Handler == nil {
				return nil, Fail(workerproto.FailureReason_FAILURE_REASON_SOURCE, "講義リンクのIDがありません。")
			}
			match := courseHandler.FindStringSubmatch(*entry.Handler)
			if match == nil {
				return nil, Fail(workerproto.FailureReason_FAILURE_REASON_SOURCE, "講義IDが不正です。")
			}
			id = match[1]
		}
		kind, weekday, period, err := parseCourseSchedule(entry.Category, entry.Period)
		if err != nil {
			slog.ErrorContext(ctx, "unrecognized LMS value",
				"id", id,
				"field", "schedule",
				"category", entry.Category,
				"period", entry.Period,
			)
		}
		item, err := course(entry.Name, id, kind, weekday, period)
		if err != nil {
			return nil, err
		}
		listing.Courses = append(listing.Courses, item)
	}
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
	expression := `(() => {
		const id = ` + js(id) + `;
		const a = [...document.querySelectorAll('.lms-weekly-area .lms-cardname a')].find(a => {
			const m = (a.getAttribute('onclick') || '').match(/\bformSubmit\(\s*["']([^"']+)["']/);
			return m && m[1] === id;
		});
		if (!a) return false;
		a.click();
		return true;
	})()`
	if err := cd.Run(ctx, cd.Evaluate(expression, &clicked)); err != nil {
		return err
	}
	if !clicked {
		return &Failure{
			Reason:  workerproto.FailureReason_FAILURE_REASON_COURSE_NOT_FOUND,
			Message: "The course is not in the current LMS listing.",
			Target:  &workerproto.Failure_CourseId{CourseId: &workerproto.CourseId{Value: id}},
		}
	}
	return poll(
		ctx,
		`document.readyState === 'complete' && location.origin === `+js(b.opts.LMSURL)+`
			&& /^\/lms\/(?:homeHoml\/doLinkKougi|corsColl\/doIndex)(?:;|$)/.test(location.pathname)
			&& (([...document.querySelectorAll('th')].some(e => e.textContent.trim() === '授業実施日')
					&& !!document.querySelector('.courseFolderName'))
				|| !!document.body?.innerText.includes('授業が登録されていません。'))`,
	)
}

type rawMaterial struct {
	ID, Name, Type, Deadline string
	Linked                   bool
}
type rawFolder struct {
	Name, Date      string
	DescriptionHTML *string
	Materials       []rawMaterial
}

func (b *Browser) readMaterials(
	ctx context.Context,
	id string,
) (*workerproto.CourseMaterials, error) {
	var folders []rawFolder
	if err := cd.Run(ctx, cd.Evaluate(materialsJS, &folders)); err != nil {
		return nil, err
	}
	result := &workerproto.CourseMaterials{
		CourseId: &workerproto.CourseId{Value: id},
		Folders:  []*workerproto.Folder{},
	}
	seen := map[string]bool{}
	for _, raw := range folders {
		date, err := parseCalendarDate(raw.Date)
		if err != nil {
			slog.ErrorContext(
				ctx,
				"unrecognized LMS value",
				"id",
				id,
				"field",
				"class_date",
				"value",
				raw.Date,
			)
		}
		calendar, err := calendarDate(date)
		if err != nil {
			return nil, err
		}
		folder := &workerproto.Folder{
			Name:            raw.Name,
			ClassDate:       calendar,
			DescriptionHtml: raw.DescriptionHTML,
			Materials:       []*workerproto.Material{},
		}
		for _, entry := range raw.Materials {
			if !materialID.MatchString(entry.ID) || seen[entry.ID] {
				return nil, Fail(
					workerproto.FailureReason_FAILURE_REASON_SOURCE,
					"教材IDが不正または重複しています。",
				)
			}
			seen[entry.ID] = true
			kind, err := parseType(entry.Type)
			if err != nil {
				slog.ErrorContext(ctx, "unrecognized LMS value",
					"id", entry.ID,
					"field", "type",
					"value", entry.Type,
				)
				kind = "unknown"
			}
			deadline, err := parseDeadline(entry.Deadline)
			if err != nil {
				slog.ErrorContext(ctx, "unrecognized LMS value",
					"id", entry.ID,
					"field", "publication_deadline",
					"value", entry.Deadline,
				)
				deadline = "unknown"
			}
			item, err := material(entry, kind, deadline)
			if err != nil {
				return nil, err
			}
			folder.Materials = append(folder.Materials, item)
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
	return "", Fail(workerproto.FailureReason_FAILURE_REASON_SOURCE, "未対応の教材種別です。")
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
	return "", Fail(workerproto.FailureReason_FAILURE_REASON_SOURCE, "LMSの日付を解析できません。")
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
	return "", Fail(workerproto.FailureReason_FAILURE_REASON_SOURCE, "LMSの日付を解析できません。")
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

func (b *Browser) readResources(ctx context.Context) (*workerproto.ResourceList, error) {
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
	resources := &workerproto.ResourceList{Resources: []*workerproto.Resource{}}
	seen := map[string]bool{}
	for _, entry := range entries {
		id, rawURL := "", ""
		for _, handler := range entry.Handlers {
			if match := fileHandler.FindStringSubmatch(handler); match != nil {
				id = match[1]
			}
			candidate := handler
			if match := windowHandler.FindStringSubmatch(handler); match != nil {
				candidate = match[1]
			}
			if !strings.HasPrefix(candidate, "javascript:") {
				parsed, err := url.Parse(candidate)
				if err != nil {
					return nil, Fail(workerproto.FailureReason_FAILURE_REASON_SOURCE, "資料URLが不正です。")
				}
				parsed = base.ResolveReference(parsed)
				if id == "" {
					id = parsed.Query().Get("syosaiId")
				}
				if rawURL == "" {
					rawURL = parsed.Query().Get("fileurl")
				}
			}
			if id == "" {
				if match := unknownHandler.FindStringSubmatch(handler); match != nil {
					id = match[1]
				}
			}
		}
		if !resourceID.MatchString(id) || seen[id] {
			return nil, Fail(workerproto.FailureReason_FAILURE_REASON_SOURCE, "資料IDが不正または重複しています。")
		}
		seen[id] = true
		if entry.Kind != "ファイル資料" && entry.Kind != "外部資料" {
			slog.ErrorContext(
				ctx,
				"unrecognized LMS value",
				"id",
				id,
				"field",
				"type",
				"value",
				entry.Kind,
			)
		}
		item, err := resource(id, entry.Name, entry.Kind, rawURL)
		if err != nil {
			return nil, err
		}
		resources.Resources = append(resources.Resources, item)
	}
	return resources, nil
}

func (b *Browser) materialSnapshot(
	ctx context.Context,
	material, preferred string,
) (*workerproto.Snapshot, error) {
	courses, err := b.readCourses(ctx)
	if err != nil {
		return nil, err
	}
	ids := []string{}
	seen := map[string]bool{}
	missing := &workerproto.Snapshot{
		AcademicYear: courses.AcademicYear,
		Courses:      courses.Courses,
		MaterialId:   &workerproto.MaterialId{Value: material},
	}
	for _, c := range courses.Courses {
		id := c.GetAvailable().GetValue()
		if c.GetAvailable() != nil && id == preferred && !seen[id] {
			seen[id] = true
			ids = append(ids, id)
		}
	}
	for _, c := range courses.Courses {
		id := c.GetAvailable().GetValue()
		if c.GetAvailable() != nil && id != preferred && !seen[id] {
			seen[id] = true
			ids = append(ids, id)
		}
	}
	for _, id := range ids {
		if err = b.home(ctx); err != nil {
			return nil, err
		}
		if err = b.openCourse(ctx, id); err != nil {
			return nil, err
		}
		materials, err := b.readMaterials(ctx, id)
		if err != nil {
			return nil, err
		}
		if id == preferred {
			missing.CourseMaterials = materials
		}
		for _, folder := range materials.Folders {
			for _, m := range folder.Materials {
				if m.GetId().GetValue() != material {
					continue
				}
				snapshot := &workerproto.Snapshot{
					AcademicYear:    courses.AcademicYear,
					Courses:         courses.Courses,
					CourseMaterials: materials,
					MaterialId:      &workerproto.MaterialId{Value: material},
				}
				if m.GetDocument().GetResourceAvailability() !=
					workerproto.LinkAvailability_LINK_AVAILABILITY_AVAILABLE {
					return snapshot, nil
				}
				if err = cd.Run(
					ctx,
					cd.Evaluate(
						fmt.Sprintf(
							`document.querySelector('td.kyozaititleCell#%s a').click()`,
							material,
						),
						nil,
					),
				); err != nil {
					return snapshot, err
				}
				if err = poll(
					ctx,
					`location.origin === `+js(b.opts.LMSURL)+`
						&& /^\/lms\/corsColl\/doLinkKyozaiTitle(?:;|$)/.test(location.pathname)
						&& [...document.querySelectorAll('th')].some(
							e => e.textContent.trim() === '資料名'
						)`,
				); err != nil {
					return snapshot, err
				}
				snapshot.ResourceList, err = b.readResources(ctx)
				return snapshot, err
			}
		}
	}
	if preferred != "" {
		return missing, nil
	}
	return nil, &Failure{
		Reason:  workerproto.FailureReason_FAILURE_REASON_MATERIAL_NOT_FOUND,
		Message: "The material is not in the current LMS listing. Refer to saved data.",
		Target: &workerproto.Failure_MaterialId{
			MaterialId: &workerproto.MaterialId{Value: material},
		},
	}
}

func (b *Browser) Courses(ctx context.Context) (courses *workerproto.CourseListing, err error) {
	err = b.withPage(ctx, func(tab context.Context) error {
		var e error
		courses, e = b.readCourses(tab)
		return e
	})
	return
}

func (b *Browser) Materials(
	ctx context.Context,
	id string,
) (snapshot *workerproto.Snapshot, err error) {
	err = b.withPage(ctx, func(tab context.Context) error {
		courses, e := b.readCourses(tab)
		if e != nil {
			return e
		}
		if e = b.openCourse(tab, id); e != nil {
			return e
		}
		materials, e := b.readMaterials(tab, id)
		snapshot = &workerproto.Snapshot{
			AcademicYear:    courses.AcademicYear,
			Courses:         courses.Courses,
			CourseMaterials: materials,
		}
		return e
	})
	return
}

func (b *Browser) Resources(
	ctx context.Context,
	material, preferred string,
) (snapshot *workerproto.Snapshot, err error) {
	err = b.withPage(ctx, func(tab context.Context) error {
		var e error
		snapshot, e = b.materialSnapshot(tab, material, preferred)
		return e
	})
	return
}
