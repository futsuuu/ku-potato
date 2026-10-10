// Package sqlite persists archive retrievals and authentication state.
package sqlite

import (
	"context"
	"database/sql"
	"errors"
	"net/url"
	"path/filepath"
	"strings"
	"time"

	"github.com/futsuuu/ku-potato/server/core/outport"
	"github.com/futsuuu/ku-potato/server/domain"
	"github.com/futsuuu/ku-potato/server/sqlite/schema"
	_ "modernc.org/sqlite"
)

type Store struct{ db *sql.DB }

var _ outport.Archive = (*Store)(nil)
var _ outport.AuthenticationState = (*Store)(nil)

func Open(path string) (*Store, error) {
	absolute, err := filepath.Abs(path)
	if err != nil {
		return nil, err
	}
	// Connection-local pragmas also apply when database/sql replaces a connection.
	dsn := url.URL{Scheme: "file", Path: "/" + strings.TrimPrefix(filepath.ToSlash(absolute), "/")}
	settings := url.Values{}
	settings.Add("_pragma", "foreign_keys(1)")
	settings.Add("_pragma", "busy_timeout(5000)")
	dsn.RawQuery = settings.Encode()
	db, err := sql.Open("sqlite", dsn.String())
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	if _, err := db.Exec("PRAGMA journal_mode=WAL"); err != nil {
		db.Close()
		return nil, err
	}
	if err := initialize(db); err != nil {
		db.Close()
		return nil, err
	}
	return &Store{db: db}, nil
}

func initialize(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(schema.SQL); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) Close() error { return s.db.Close() }

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

func millisTime(value *int64) *time.Time {
	if value == nil {
		return nil
	}
	t := time.UnixMilli(*value).UTC()
	return &t
}
