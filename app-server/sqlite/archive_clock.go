package sqlite

import (
	"context"
	"database/sql"
	"math"

	"github.com/futsuuu/ku-potato/app-server/domain"
	"github.com/futsuuu/ku-potato/app-server/sqlite/gen/model"
	"github.com/futsuuu/ku-potato/app-server/sqlite/gen/table"
	"github.com/go-jet/jet/v2/qrm"
	"github.com/go-jet/jet/v2/sqlite"
)

func loadArchiveState(ctx context.Context, db qrm.DB) (model.ArchiveState, error) {
	t := table.ArchiveState
	var state model.ArchiveState
	err := t.SELECT(t.AllColumns).WHERE(t.Singleton.EQ(sqlite.Int(1))).QueryContext(ctx, db, &state)
	return state, err
}

// Retrievals and saved-file updates share a clock that never moves backwards.
func advanceArchiveClock(state model.ArchiveState, timestamp int64) (model.ArchiveState, error) {
	if timestamp < 0 {
		return state, domain.Fail("archive", "invalid archive timestamp")
	}
	if timestamp > state.ClockMillis {
		state.ClockMillis, state.ClockCounter = timestamp, 0
	} else {
		if state.ClockCounter == math.MaxInt64 {
			return state, domain.Fail("archive", "archive clock exhausted")
		}
		state.ClockCounter++
	}
	return state, nil
}

// The clock update and the associated content writes commit or roll back together.
func newArchiveClock(ctx context.Context, tx *sql.Tx, timestamp int64) (model.ArchiveState, error) {
	state, err := loadArchiveState(ctx, tx)
	if err != nil {
		return state, err
	}
	state, err = advanceArchiveClock(state, timestamp)
	if err != nil {
		return state, err
	}
	t := table.ArchiveState
	_, err = t.UPDATE(t.ClockMillis, t.ClockCounter).
		SET(state.ClockMillis, state.ClockCounter).
		WHERE(t.Singleton.EQ(sqlite.Int(1))).ExecContext(ctx, tx)
	return state, err
}
