package sqlite

import (
	"context"
	"database/sql"
	"errors"

	"github.com/futsuuu/ku-potato/app-server/domain"
	"github.com/futsuuu/ku-potato/app-server/sqlite/gen/model"
	"github.com/futsuuu/ku-potato/app-server/sqlite/gen/table"
	"github.com/go-jet/jet/v2/qrm"
	"github.com/go-jet/jet/v2/sqlite"
)

func insertReport(
	ctx context.Context,
	tx *sql.Tx,
	id string,
	timestamp retrievalTimestamp,
	material string,
	detail domain.ReportDetail,
) (string, error) {
	r := table.ReportDetailRetrievals
	_, err := r.INSERT(r.AllColumns).MODEL(model.ReportDetailRetrievals{
		ID:               id,
		LmsMaterialID:    material,
		RetrievedAt:      timestamp.RetrievedAt,
		TimestampMillis:  timestamp.TimestampMillis,
		TimestampCounter: timestamp.TimestampCounter,
	}).ExecContext(ctx, tx)
	if err != nil {
		return "", err
	}

	row := model.ReportDetails{
		RetrievalID: id,
		PromptHTML:  detail.PromptHTML,
		Status:      materialStatus(material, "report", detail.Status),
		SubmissionPeriodKind: enumValue(
			material,
			"submission_period_kind",
			detail.SubmissionPeriodKind,
			"at",
			"unlisted",
		),
		SubmissionStartsAt: millis(detail.SubmissionStartsAt),
		SubmissionDueAt:    millis(detail.SubmissionDueAt),
		CorrectionMode: enumValue(
			material,
			"correction_mode",
			detail.CorrectionMode,
			"not-allowed",
			"unlimited",
			"limited",
		),
		CorrectionLimit:   nonnegative(material, "correction_limit", detail.CorrectionLimit),
		TextAnswerAllowed: optionalBool(detail.TextAnswerAllowed),
		FileAnswerAllowed: optionalBool(detail.FileAnswerAllowed),
		MaxTotalFileBytes: nonnegative(material, "max_total_file_bytes", detail.MaxTotalFileBytes),
	}
	if row.SubmissionPeriodKind != "at" {
		row.SubmissionStartsAt, row.SubmissionDueAt = nil, nil
	} else if (row.SubmissionStartsAt == nil && row.SubmissionDueAt == nil) ||
		(row.SubmissionStartsAt != nil && row.SubmissionDueAt != nil && *row.SubmissionDueAt < *row.SubmissionStartsAt) {
		unknown(
			material,
			"submission_period",
			[]any{detail.SubmissionStartsAt, detail.SubmissionDueAt},
		)
		row.SubmissionPeriodKind, row.SubmissionStartsAt, row.SubmissionDueAt = "unknown", nil, nil
	}
	if row.CorrectionMode != "limited" {
		row.CorrectionLimit = nil
	} else if row.CorrectionLimit == nil {
		unknown(material, "correction_limit", detail.CorrectionLimit)
		row.CorrectionMode = "unknown"
	}
	t := table.ReportDetails
	if _, err := t.INSERT(t.AllColumns).MODEL(row).ExecContext(ctx, tx); err != nil {
		return "", err
	}
	return id, nil
}

// ReportDetail is independently readable, including after the material becomes private.
func (s *Store) ReportDetail(ctx context.Context, material string) (domain.ReportDetail, error) {
	return readStore(
		ctx,
		s,
		func(db qrm.DB) (domain.ReportDetail, error) { return reportDetail(ctx, db, material) },
	)
}

func reportDetail(ctx context.Context, db qrm.DB, material string) (domain.ReportDetail, error) {
	t, r := table.ReportDetails, table.ReportDetailRetrievals
	var row struct {
		model.ReportDetails
		model.ReportDetailRetrievals
	}
	err := t.SELECT(t.AllColumns, r.AllColumns).
		FROM(t.INNER_JOIN(r, t.RetrievalID.EQ(r.ID))).
		WHERE(r.LmsMaterialID.EQ(sqlite.String(material))).
		ORDER_BY(retrievalOrder(r.TimestampMillis, r.TimestampCounter, r.ID)...).
		LIMIT(1).
		QueryContext(ctx, db, &row)
	if errors.Is(err, qrm.ErrNoRows) {
		return domain.ReportDetail{}, domain.ErrMissing
	}
	if err != nil {
		return domain.ReportDetail{}, err
	}
	return domain.ReportDetail{
		PromptHTML:           row.PromptHTML,
		Status:               row.Status,
		SubmissionPeriodKind: row.SubmissionPeriodKind,
		SubmissionStartsAt:   millisTime(row.SubmissionStartsAt),
		SubmissionDueAt:      millisTime(row.SubmissionDueAt),
		CorrectionMode:       row.CorrectionMode,
		CorrectionLimit:      row.CorrectionLimit,
		TextAnswerAllowed:    storedBool(row.TextAnswerAllowed),
		FileAnswerAllowed:    storedBool(row.FileAnswerAllowed),
		MaxTotalFileBytes:    row.MaxTotalFileBytes,
		RetrievedAt:          millisTime(&row.RetrievedAt),
	}, nil
}
