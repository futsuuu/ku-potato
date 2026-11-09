package sqlite

import (
	"context"
	"database/sql"
	"time"

	"github.com/go-jet/jet/v2/sqlite"
)

type retrievalTimestamp struct {
	RetrievedAt      int64
	TimestampMillis  int64
	TimestampCounter int64
}

// All retrievals in an Append share the same times, but have distinct IDs.
func newRetrievalTimestamp(ctx context.Context, tx *sql.Tx) (retrievalTimestamp, error) {
	retrievedAt := time.Now().UnixMilli()
	timestamp, err := nextArchiveTimestamp(ctx, tx, retrievedAt)
	return retrievalTimestamp{
		RetrievedAt:      retrievedAt,
		TimestampMillis:  timestamp.Millis,
		TimestampCounter: timestamp.Counter,
	}, err
}

// Independent writers may issue the same timestamp. The retrieval ID breaks ties.
func retrievalOrder(
	millis, counter sqlite.IntegerExpression,
	id sqlite.StringExpression,
	rows ...sqlite.OrderByClause,
) []sqlite.OrderByClause {
	return append([]sqlite.OrderByClause{millis.DESC(), counter.DESC(), id.DESC()}, rows...)
}
