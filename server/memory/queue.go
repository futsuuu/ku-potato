// Package memory implements process-local adapters.
package memory

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"sync"
	"time"

	"github.com/futsuuu/ku-potato/server/core/outport"
	"github.com/futsuuu/ku-potato/server/domain"
)

type record struct {
	job     domain.Job
	key     string
	ready   time.Time
	events  []domain.Job
	changed chan struct{}
}

type Queue struct {
	mu    sync.Mutex
	jobs  map[string]*record
	order []*record
	now   func() time.Time
}

var _ outport.Queue = (*Queue)(nil)

func NewQueue() *Queue {
	return &Queue{jobs: make(map[string]*record), now: func() time.Time { return time.Now().UTC() }}
}

// Copy all mutable fields so callers cannot mutate queue state or race with the worker.
func clone(job domain.Job) domain.Job {
	job.Request.CourseIDs = append([]string(nil), job.Request.CourseIDs...)
	job.Result = append(json.RawMessage(nil), job.Result...)
	if job.Progress != nil {
		p := *job.Progress
		job.Progress = &p
	}
	if job.Error != nil {
		failure := *job.Error
		job.Error = &failure
	}
	return job
}

func requestKey(r domain.Request) string {
	body, _ := json.Marshal(r)
	return string(body)
}

func (q *Queue) active(key string) *record {
	for _, r := range q.order {
		if r.key == key && (r.job.Status == "queued" || r.job.Status == "running") {
			return r
		}
	}
	return nil
}

func (q *Queue) Enqueue(ctx context.Context, request domain.Request) (domain.Job, error) {
	if err := ctx.Err(); err != nil {
		return domain.Job{}, err
	}
	q.mu.Lock()
	defer q.mu.Unlock()
	key := requestKey(request)
	if existing := q.active(key); existing != nil {
		return clone(existing.job), nil
	}
	now := q.now()
	job := clone(domain.Job{ID: rand.Text(), Request: request, Status: "queued", CreatedAt: now, UpdatedAt: now})
	job.Progress = &domain.Progress{Stage: "waiting"}
	r := &record{job: job, key: key, changed: make(chan struct{})}
	q.publish(r)
	q.jobs[job.ID] = r
	q.order = append(q.order, r)
	return clone(job), nil
}

func (q *Queue) Job(ctx context.Context, id string) (domain.Job, error) {
	if err := ctx.Err(); err != nil {
		return domain.Job{}, err
	}
	q.mu.Lock()
	defer q.mu.Unlock()
	r := q.jobs[id]
	if r == nil {
		return domain.Job{}, domain.ErrMissing
	}
	return clone(r.job), nil
}

func (q *Queue) Claim(ctx context.Context) (*domain.Job, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	q.mu.Lock()
	defer q.mu.Unlock()
	for _, r := range q.order {
		if r.job.Status != "queued" || r.ready.After(q.now()) {
			continue
		}
		r.job.Status = "running"
		r.job.Progress = &domain.Progress{Stage: "waiting"}
		r.job.Error = nil
		r.job.Attempts++
		r.job.UpdatedAt = q.now()
		q.publish(r)
		job := clone(r.job)
		return &job, nil
	}
	return nil, nil
}

func (q *Queue) Finish(ctx context.Context, job domain.Job, result any, failure error) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	q.mu.Lock()
	defer q.mu.Unlock()
	r := q.jobs[job.ID]
	if r == nil {
		return domain.ErrMissing
	}
	if r.job.Status != "running" || job.Attempts != r.job.Attempts {
		return domain.Fail("conflict", "job is not running")
	}
	updated := r.job
	updated.UpdatedAt = q.now()
	updated.Error, updated.Result = nil, nil
	updated.Status = "succeeded"
	ready := time.Time{}
	if failure != nil {
		updated.Error = publicError(failure)
		updated.Status = "failed"
		if updated.Error.Reason == "authentication-required" {
			updated.Status = "blocked"
		}
		if (updated.Error.Reason == "source" || updated.Error.Reason == "timeout") && updated.Attempts < 3 && updated.Request.Kind != "register-webauthn" {
			updated.Status = "queued"
			ready = q.now().Add(time.Duration(updated.Attempts) * 2 * time.Second)
		}
	} else {
		body, err := json.Marshal(result)
		if err != nil {
			return err
		}
		updated.Result = body
		p := domain.Progress{Stage: "completed", Completed: 1, Total: 1}
		if updated.Progress != nil && updated.Progress.Total > 0 {
			p.Completed, p.Total = updated.Progress.Total, updated.Progress.Total
		}
		updated.Progress = &p
	}
	r.job, r.ready = clone(updated), ready
	q.publish(r)
	return nil
}

func publicError(err error) *domain.Error {
	var e *domain.Error
	if errors.As(err, &e) {
		failure := *e
		return &failure
	}
	if errors.Is(err, domain.ErrMissing) {
		return &domain.Error{Reason: "archive-data-missing", Message: "保存済みデータがありません。"}
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return &domain.Error{Reason: "timeout", Message: "処理がタイムアウトしました。"}
	}
	return &domain.Error{Reason: "internal", Message: "処理に失敗しました。サーバログを確認してください。"}
}

// publish retains transitions for observers attaching after a fast operation.
// Callers hold q.mu; a slow observer never holds up workers or other observers.
func (q *Queue) publish(r *record) {
	r.events = append(r.events, clone(r.job))
	close(r.changed)
	r.changed = make(chan struct{})
}
func (q *Queue) Progress(ctx context.Context, job domain.Job, p domain.Progress) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	q.mu.Lock()
	defer q.mu.Unlock()
	r := q.jobs[job.ID]
	if r == nil {
		return domain.ErrMissing
	}
	if r.job.Status != "running" || r.job.Attempts != job.Attempts {
		return domain.Fail("conflict", "job is not running")
	}
	r.job.Progress = &p
	r.job.UpdatedAt = q.now()
	q.publish(r)
	return nil
}
func (q *Queue) Observe(ctx context.Context, id string, observe func(domain.Job) error) error {
	cursor := 0
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		q.mu.Lock()
		r := q.jobs[id]
		if r == nil {
			q.mu.Unlock()
			return domain.ErrMissing
		}
		batch := make([]domain.Job, len(r.events)-cursor)
		for i := range batch {
			batch[i] = clone(r.events[cursor+i])
		}
		cursor = len(r.events)
		changed := r.changed
		q.mu.Unlock()
		for _, job := range batch {
			if err := ctx.Err(); err != nil {
				return err
			}
			if err := observe(job); err != nil {
				return err
			}
			switch job.Status {
			case "succeeded", "failed", "blocked":
				return nil
			}
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-changed:
		}
	}
}
