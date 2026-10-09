// Package sqlite persists the server's archive snapshots.
package sqlite

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"time"

	"github.com/futsuuu/ku-potato/server/core/outport"
	"github.com/futsuuu/ku-potato/server/domain"
	_ "modernc.org/sqlite"
)

type Store struct{ db *sql.DB }

var _ outport.Archive = (*Store)(nil)
var _ outport.AuthenticationState = (*Store)(nil)

func Open(path string) (*Store, error) {
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	s := &Store{db: db}
	var version int
	if err = db.QueryRow("PRAGMA user_version").Scan(&version); err != nil {
		db.Close()
		return nil, err
	}
	if version > 2 {
		db.Close()
		return nil, domain.Fail("archive", "unsupported archive schema version")
	}
	_, err = db.Exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
	BEGIN;
	CREATE TABLE IF NOT EXISTS snapshots(kind TEXT NOT NULL, id TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(kind,id));
	DROP TABLE IF EXISTS jobs;
	PRAGMA user_version=2;
	COMMIT;`)
	if err != nil {
		db.Close()
		return nil, err
	}
	return s, nil
}
func (s *Store) Close() error { return s.db.Close() }

type querier interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

func read[T any](ctx context.Context, q querier, kind, id string) (T, error) {
	var value T
	var body []byte
	err := q.QueryRowContext(ctx, "SELECT body FROM snapshots WHERE kind=? AND id=?", kind, id).Scan(&body)
	if errors.Is(err, sql.ErrNoRows) {
		return value, domain.ErrMissing
	}
	if err != nil {
		return value, err
	}
	err = json.Unmarshal(body, &value)
	return value, err
}
func put(ctx context.Context, tx *sql.Tx, kind, id string, value any) error {
	body, err := json.Marshal(value)
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, "INSERT INTO snapshots(kind,id,body) VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET body=excluded.body", kind, id, string(body))
	return err
}
func (s *Store) Courses(ctx context.Context) ([]domain.Course, error) {
	return read[[]domain.Course](ctx, s.db, "courses", "")
}
func (s *Store) Materials(ctx context.Context, id string) (domain.CourseMaterials, error) {
	materials, err := read[domain.CourseMaterials](ctx, s.db, "materials", id)
	if err != nil {
		return materials, err
	}
	courses, err := s.Courses(ctx)
	if err != nil {
		return materials, err
	}
	for _, course := range courses {
		if course.ID == id && course.Archived {
			for i := range materials.Folders {
				for j := range materials.Folders[i].Materials {
					materials.Folders[i].Materials[j].Archived = true
				}
			}
		}
	}
	return materials, nil
}
func (s *Store) FindCourse(ctx context.Context, material string) (string, error) {
	id, err := read[string](ctx, s.db, "material-course", material)
	if errors.Is(err, domain.ErrMissing) {
		return "", nil
	}
	return id, err
}
func (s *Store) Detail(ctx context.Context, id string) (domain.Detail, error) {
	courseID, err := s.FindCourse(ctx, id)
	if err != nil {
		return domain.Detail{}, err
	}
	if courseID == "" {
		return domain.Detail{}, domain.ErrMissing
	}
	materials, err := s.Materials(ctx, courseID)
	if err != nil {
		return domain.Detail{}, err
	}
	courses, err := s.Courses(ctx)
	if err != nil {
		return domain.Detail{}, err
	}
	var detail domain.Detail
	for _, c := range courses {
		if c.ID == courseID {
			detail.Course = c
		}
	}
	found := false
	for _, f := range materials.Folders {
		for _, m := range f.Materials {
			if m.ID == id {
				detail.Material = m
				found = true
			}
		}
	}
	if !found {
		return detail, domain.ErrMissing
	}
	detail.Resources, err = read[[]domain.Resource](ctx, s.db, "resources", id)
	if detail.Material.Archived {
		for i := range detail.Resources {
			detail.Resources[i].Availability = "archived"
		}
	}
	return detail, err
}
func (s *Store) Append(ctx context.Context, snapshot domain.Snapshot) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	old, err := read[[]domain.Course](ctx, tx, "courses", "")
	if err != nil && !errors.Is(err, domain.ErrMissing) {
		return err
	}
	if snapshot.Courses != nil {
		if err = put(ctx, tx, "courses", "", domain.MergeCourses(old, snapshot.Courses)); err != nil {
			return err
		}
	}
	if snapshot.Materials != nil {
		current := *snapshot.Materials
		old, err := read[domain.CourseMaterials](ctx, tx, "materials", current.CourseID)
		if err != nil && !errors.Is(err, domain.ErrMissing) {
			return err
		}
		merged := domain.MergeMaterials(old, current)
		if err = put(ctx, tx, "materials", current.CourseID, merged); err != nil {
			return err
		}
		for _, f := range merged.Folders {
			for _, m := range f.Materials {
				if err = put(ctx, tx, "material-course", m.ID, current.CourseID); err != nil {
					return err
				}
			}
		}
	}
	if snapshot.MaterialID != "" {
		old, err := read[[]domain.Resource](ctx, tx, "resources", snapshot.MaterialID)
		if err != nil && !errors.Is(err, domain.ErrMissing) {
			return err
		}
		if err = put(ctx, tx, "resources", snapshot.MaterialID, domain.MergeResources(old, snapshot.Resources)); err != nil {
			return err
		}
	}
	return tx.Commit()
}
func (s *Store) Acquired(ctx context.Context, material, resource string, file *domain.SavedFile, failure error) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	resources, err := read[[]domain.Resource](ctx, tx, "resources", material)
	if err != nil {
		return err
	}
	found := false
	now := time.Now().UTC()
	for i := range resources {
		r := &resources[i]
		if r.ID != resource {
			continue
		}
		found = true
		if r.Acquisition == nil {
			r.Acquisition = &domain.Acquisition{}
		}
		r.Acquisition.LastAttempt = domain.Attempt{At: now, Status: "success"}
		if failure == nil {
			r.Acquisition.LastSucceededAt = &now
			if file != nil {
				r.SavedFile = file
			}
		} else {
			r.Acquisition.LastAttempt.Status = "failure"
			r.Acquisition.LastAttempt.Error = publicError(failure).Message
		}
	}
	if !found {
		return domain.ErrMissing
	}
	if err = put(ctx, tx, "resources", material, resources); err != nil {
		return err
	}
	return tx.Commit()
}
func (s *Store) Auth(ctx context.Context) (domain.AuthState, error) {
	state, err := read[domain.AuthState](ctx, s.db, "auth", "")
	if errors.Is(err, domain.ErrMissing) {
		return domain.AuthState{Status: "unknown"}, nil
	}
	return state, err
}
func (s *Store) SetAuth(ctx context.Context, status string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	now := time.Now().UTC()
	if err = put(ctx, tx, "auth", "", domain.AuthState{Status: status, CheckedAt: &now}); err != nil {
		return err
	}
	return tx.Commit()
}
func publicError(err error) *domain.Error {
	var e *domain.Error
	if errors.As(err, &e) {
		return e
	}
	if errors.Is(err, domain.ErrMissing) {
		return &domain.Error{Reason: "archive-data-missing", Message: "保存済みデータがありません。"}
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return &domain.Error{Reason: "timeout", Message: "処理がタイムアウトしました。"}
	}
	return &domain.Error{Reason: "internal", Message: "処理に失敗しました。"}
}
