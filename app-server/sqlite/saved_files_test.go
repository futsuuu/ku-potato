package sqlite

import (
	"context"
	"math"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/futsuuu/ku-potato/app-server/domain"
	"github.com/futsuuu/ku-potato/app-server/sqlite/gen/model"
	"github.com/futsuuu/ku-potato/app-server/sqlite/gen/table"
	"github.com/go-jet/jet/v2/sqlite"
)

func storedSavedFile(t *testing.T, s *Store) model.SavedFiles {
	t.Helper()
	var row model.SavedFiles
	r := table.SavedFiles
	if err := r.SELECT(r.AllColumns).QueryContext(context.Background(), s.db, &row); err != nil {
		t.Fatal(err)
	}
	return row
}

func TestSavedFileTimestampSurvivesRestartAndIsIndependentOfRetrieval(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "archive.sqlite")
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = s.Close() })
	ids, err := s.Append(ctx, archiveSnapshot())
	if err != nil {
		t.Fatal(err)
	}
	future := time.Now().Add(24 * time.Hour).UnixMilli()
	if _, err := s.db.Exec(
		"UPDATE archive_state SET clock_millis = ?, clock_counter = 10",
		future,
	); err != nil {
		t.Fatal(err)
	}
	file := domain.SavedFile{
		ContentHash:      strings.Repeat("a", 64),
		OriginalFilename: "first.pdf", OriginalSize: 1,
	}
	for i := int64(11); i <= 12; i++ {
		if _, err := s.ReplaceSavedFile(ctx, "SRY1", "SRS1", ids.Resources, file); err != nil {
			t.Fatal(err)
		}
		row := storedSavedFile(t, s)
		if row.TimestampMillis != future || row.TimestampCounter != i ||
			row.ResourceRetrievalID != ids.Resources || savedFile(row) != file {
			t.Fatal("saved-file update did not receive a new timestamp", row)
		}
		// Updating metadata for the same content must also receive a new timestamp.
		file.OriginalFilename = "renamed.pdf"
	}
	before := storedSavedFile(t, s)
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	s, err = Open(path)
	if err != nil {
		t.Fatal(err)
	}
	if after := storedSavedFile(t, s); before != after {
		t.Fatal("restart changed saved-file update metadata", before, after)
	}
	if _, err := s.Append(ctx, archiveSnapshot()); err != nil {
		t.Fatal(err)
	}
	state, err := loadArchiveState(ctx, s.db)
	if err != nil || state.ClockMillis != future || state.ClockCounter != 13 {
		t.Fatal("retrieval did not use the shared archive clock", state, err)
	}
	// A later save may still refer to an older retrieval, without reusing its timestamp.
	if _, err := s.ReplaceSavedFile(ctx, "SRY1", "SRS1", ids.Resources, file); err != nil {
		t.Fatal(err)
	}
	row := storedSavedFile(t, s)
	if row.TimestampMillis != future || row.TimestampCounter != 14 ||
		row.ResourceRetrievalID != ids.Resources {
		t.Fatal(row)
	}
	var count int
	if err := s.db.QueryRow("SELECT count(*) FROM saved_files").
		Scan(&count); err != nil ||
		count != 1 {
		t.Fatal("update retained saved-file history", count, err)
	}
}

func TestFailedSavedFileUpdateRollsBackClockAndCurrentFile(t *testing.T) {
	ctx := context.Background()
	s := newStore(t)
	ids, err := s.Append(ctx, archiveSnapshot())
	if err != nil {
		t.Fatal(err)
	}
	file := domain.SavedFile{
		ContentHash:      strings.Repeat("a", 64),
		OriginalFilename: "file.pdf", OriginalSize: 1,
	}
	if _, err := s.ReplaceSavedFile(ctx, "SRY1", "SRS1", ids.Resources, file); err != nil {
		t.Fatal(err)
	}
	before := storedSavedFile(t, s)
	state, err := loadArchiveState(ctx, s.db)
	if err != nil {
		t.Fatal(err)
	}
	file.OriginalFilename = "replacement.pdf"
	for _, test := range []struct{ resource, retrieval string }{
		{"SRS1", "missing"},     // Failed replacement.
		{"SRS3", ids.Resources}, // Failed insertion.
	} {
		if _, err := s.ReplaceSavedFile(
			ctx,
			"SRY1",
			test.resource,
			test.retrieval,
			file,
		); err == nil {
			t.Fatal("accepted invalid saved-file reference", test)
		}
		if after := storedSavedFile(t, s); before != after {
			t.Fatal("failed update changed current file or revision", before, after)
		}
		if after, err := loadArchiveState(ctx, s.db); err != nil || state != after {
			t.Fatal("failed update advanced archive clock", state, after, err)
		}
	}
	// Clock exhaustion must not replace the file either.
	if _, err := s.db.Exec("UPDATE archive_state SET clock_millis = ?, clock_counter = ?",
		time.Now().Add(24*time.Hour).UnixMilli(), int64(math.MaxInt64)); err != nil {
		t.Fatal(err)
	}
	if _, err := s.ReplaceSavedFile(ctx, "SRY1", "SRS1", ids.Resources, file); err == nil {
		t.Fatal("accepted update with exhausted clock")
	}
	if after := storedSavedFile(t, s); before != after {
		t.Fatal("clock exhaustion changed current file", before, after)
	}
	for _, column := range []sqlite.ColumnInteger{table.SavedFiles.TimestampMillis, table.SavedFiles.TimestampCounter} {
		r := table.SavedFiles
		if _, err := r.UPDATE(column).SET(int64(-1)).
			WHERE(r.LmsMaterialID.EQ(sqlite.String("SRY1"))).ExecContext(ctx, s.db); err == nil {
			t.Fatal("accepted negative update timestamp", column)
		}
	}
}
