package sqlite

import (
	"context"
	"database/sql"
	"time"

	"github.com/go-jet/jet/v2/sqlite"
)

type retrievalClock struct {
	FetchedAt    int64
	ClockMillis  int64
	ClockCounter int64
}

// All retrievals in an Append share a timestamp and clock value, but not an ID.
// The clock update and content writes commit or roll back together.
func newRetrievalClock(ctx context.Context, tx *sql.Tx) (retrievalClock, error) {
	fetchedAt := time.Now().UnixMilli()
	state, err := newArchiveClock(ctx, tx, fetchedAt)
	return retrievalClock{
		FetchedAt: fetchedAt, ClockMillis: state.ClockMillis, ClockCounter: state.ClockCounter,
	}, err
}

// Independent writers may use the same clock value. The retrieval ID breaks ties.
func retrievalOrder(
	millis, counter sqlite.IntegerExpression,
	id sqlite.StringExpression,
	rows ...sqlite.OrderByClause,
) []sqlite.OrderByClause {
	return append([]sqlite.OrderByClause{millis.DESC(), counter.DESC(), id.DESC()}, rows...)
}
