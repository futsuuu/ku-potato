package sqlite

import (
	"context"
	"database/sql"
	"math"
	"time"

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

type retrievalClock struct {
	FetchedAt    int64
	ClockMillis  int64
	ClockCounter int64
}

// The logical clock never moves backwards, even if the displayed retrieval time does.
func advanceRetrievalClock(state model.ArchiveState, fetchedAt int64) (retrievalClock, error) {
	clock := retrievalClock{
		FetchedAt: fetchedAt, ClockMillis: state.ClockMillis, ClockCounter: state.ClockCounter,
	}
	if fetchedAt < 0 {
		return clock, domain.Fail("archive", "invalid retrieval timestamp")
	}
	if fetchedAt > state.ClockMillis {
		clock.ClockMillis, clock.ClockCounter = fetchedAt, 0
	} else {
		if state.ClockCounter == math.MaxInt64 {
			return clock, domain.Fail("archive", "retrieval clock exhausted")
		}
		clock.ClockCounter++
	}
	return clock, nil
}

// All retrievals in an Append share a timestamp and clock value, but not an ID.
// The clock update and content writes commit or roll back together.
func newRetrievalClock(ctx context.Context, tx *sql.Tx) (retrievalClock, error) {
	state, err := loadArchiveState(ctx, tx)
	if err != nil {
		return retrievalClock{}, err
	}
	clock, err := advanceRetrievalClock(state, time.Now().UnixMilli())
	if err != nil {
		return clock, err
	}
	t := table.ArchiveState
	_, err = t.UPDATE(t.ClockMillis, t.ClockCounter).
		SET(clock.ClockMillis, clock.ClockCounter).
		WHERE(t.Singleton.EQ(sqlite.Int(1))).ExecContext(ctx, tx)
	return clock, err
}

// Independent writers may use the same clock value. The retrieval ID breaks ties.
func retrievalOrder(
	millis, counter sqlite.IntegerExpression,
	id sqlite.StringExpression,
	rows ...sqlite.OrderByClause,
) []sqlite.OrderByClause {
	return append([]sqlite.OrderByClause{millis.DESC(), counter.DESC(), id.DESC()}, rows...)
}
