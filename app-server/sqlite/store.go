// Package sqlite persists retrieval history and current saved files.
package sqlite

import (
	"database/sql"
	"net/url"
	"path/filepath"
	"strings"
	"time"

	"github.com/futsuuu/ku-potato/app-server/application/outport"
	"github.com/futsuuu/ku-potato/app-server/sqlite/schema"
	_ "modernc.org/sqlite"
)

type Store struct{ db *sql.DB }

var _ outport.Archive = (*Store)(nil)

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
		_ = db.Close()
		return nil, err
	}
	if err := initialize(db); err != nil {
		_ = db.Close()
		return nil, err
	}
	return &Store{db: db}, nil
}

func initialize(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.Exec(schema.SQL); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) Close() error { return s.db.Close() }

func millisTime(value *int64) *time.Time {
	if value == nil {
		return nil
	}
	t := time.UnixMilli(*value).UTC()
	return &t
}
