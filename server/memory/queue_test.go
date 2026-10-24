package memory

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/futsuuu/ku-potato/server/core/operation"
	"github.com/futsuuu/ku-potato/server/domain"
)

func TestConcurrentSubmissionsDeduplicateAndClaimOnce(t *testing.T) {
	q := NewQueue()
	ctx := context.Background()
	var wg sync.WaitGroup
	ids := make(chan string, 20)
	for range 20 {
		wg.Go(func() {
			job, err := q.Enqueue(ctx, operation.Request{Kind: "sync-courses"})
			if err != nil {
				t.Error(err)
				return
			}
			ids <- job.ID
		})
	}
	wg.Wait()
	close(ids)
	id := ""
	for got := range ids {
		if id != "" && id != got {
			t.Fatalf("duplicate jobs: %s %s", id, got)
		}
		id = got
	}
	job, err := q.Claim(ctx)
	if err != nil || job == nil || job.ID != id {
		t.Fatalf("claim: %#v %v", job, err)
	}
	next, err := q.Claim(ctx)
	if err != nil || next != nil {
		t.Fatalf("claimed twice: %#v %v", next, err)
	}
	active, err := q.Enqueue(ctx, job.Request)
	if err != nil || active.ID != job.ID {
		t.Fatalf("running duplicate: %#v %v", active, err)
	}
	if err := q.Finish(ctx, *job, nil, nil); err != nil {
		t.Fatal(err)
	}
	fresh, err := q.Enqueue(ctx, job.Request)
	if err != nil || fresh.ID == job.ID {
		t.Fatalf("completed job blocks fresh submission: %#v %v", fresh, err)
	}
	if _, err := NewQueue().Job(ctx, job.ID); !errors.Is(err, domain.ErrMissing) {
		t.Fatalf("job survived queue replacement: %v", err)
	}
}

func TestRetryBackoffLimitAndRegistrationSafety(t *testing.T) {
	ctx := context.Background()
	now := time.Now().UTC()
	q := NewQueue()
	q.now = func() time.Time { return now }
	queued, err := q.Enqueue(ctx, operation.Request{Kind: "sync-courses"})
	if err != nil {
		t.Fatal(err)
	}
	for attempt := 1; attempt <= 3; attempt++ {
		job, err := q.Claim(ctx)
		if err != nil || job == nil || job.Attempts != attempt {
			t.Fatalf("attempt %d: %#v %v", attempt, job, err)
		}
		if err := q.Finish(ctx, *job, nil, context.DeadlineExceeded); err != nil {
			t.Fatal(err)
		}
		state, err := q.Job(ctx, job.ID)
		if err != nil {
			t.Fatal(err)
		}
		if attempt < 3 {
			if state.Status != "queued" || state.Error.Reason != "timeout" {
				t.Fatal(state)
			}
			if early, err := q.Claim(ctx); err != nil || early != nil {
				t.Fatalf("ignored retry delay: %#v %v", early, err)
			}
			now = now.Add(time.Duration(attempt) * 2 * time.Second)
		} else if state.Status != "failed" {
			t.Fatal(state)
		}
	}
	retried, err := q.Enqueue(ctx, queued.Request)
	if err != nil || retried.Attempts != 0 || retried.Status != "queued" {
		t.Fatal(retried, err)
	}
	running, err := q.Claim(ctx)
	if err != nil || running == nil {
		t.Fatal(running, err)
	}
	if err := q.Finish(ctx, *running, nil, nil); err != nil {
		t.Fatal(err)
	}
	registration, err := q.Enqueue(ctx, operation.Request{Kind: "register-webauthn"})
	if err != nil {
		t.Fatal(err)
	}
	running, err = q.Claim(ctx)
	if err != nil || running == nil {
		t.Fatal(running, err)
	}
	if err := q.Finish(ctx, *running, nil, domain.Fail("source", "network")); err != nil {
		t.Fatal(err)
	}
	state, err := q.Job(ctx, registration.ID)
	if err != nil || state.Status != "failed" {
		t.Fatalf("registration retried: %#v %v", state, err)
	}
}

func TestReturnedJobsDoNotShareMutableState(t *testing.T) {
	ctx := context.Background()
	q := NewQueue()
	request := operation.Request{Kind: "sync-materials", CourseIDs: []string{"KOG1"}}
	queued, err := q.Enqueue(ctx, request)
	if err != nil {
		t.Fatal(err)
	}
	request.CourseIDs[0], queued.Request.CourseIDs[0] = "input changed", "output changed"
	running, err := q.Claim(ctx)
	if err != nil || running == nil || running.Request.CourseIDs[0] != "KOG1" {
		t.Fatal(running, err)
	}
	result := map[string]string{"value": "saved"}
	if err := q.Finish(ctx, *running, result, nil); err != nil {
		t.Fatal(err)
	}
	result["value"] = "changed"
	completed, err := q.Job(ctx, queued.ID)
	if err != nil || string(completed.Result) != `{"value":"saved"}` {
		t.Fatal(completed, err)
	}
	completed.Result[0] = '!'
	completed.Request.CourseIDs[0] = "changed again"
	stored, err := q.Job(ctx, queued.ID)
	if err != nil || string(stored.Result) != `{"value":"saved"}` || stored.Request.CourseIDs[0] != "KOG1" {
		t.Fatal(stored, err)
	}
	if _, err := q.Job(ctx, "missing"); !errors.Is(err, domain.ErrMissing) {
		t.Fatal(err)
	}
}

func TestObservationReplaysTransitionsWithoutBlockingWorkers(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	q := NewQueue()
	job, err := q.Enqueue(ctx, operation.Request{Kind: "sync-materials"})
	if err != nil {
		t.Fatal(err)
	}
	entered, release := make(chan struct{}), make(chan struct{})
	done := make(chan error, 1)
	go func() {
		done <- q.Observe(ctx, job.ID, func(j operation.Job) error {
			if j.Status == "queued" {
				close(entered)
				<-release
			}
			if j.Progress != nil {
				j.Progress.Stage = "mutated"
			}
			return nil
		})
	}()
	<-entered
	running, err := q.Claim(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if err := q.Progress(ctx, *running, operation.Progress{Stage: "fetching-materials", Completed: 1, Total: 2}); err != nil {
		t.Fatal(err)
	}
	if err := q.Finish(ctx, *running, []string{"result"}, nil); err != nil {
		t.Fatal(err)
	}
	states := []string{}
	if err := q.Observe(ctx, job.ID, func(j operation.Job) error {
		states = append(states, j.Status)
		if j.Progress != nil && j.Progress.Stage == "mutated" {
			t.Error("observer mutated shared state")
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if len(states) != 4 || states[0] != "queued" || states[1] != "running" || states[2] != "running" || states[3] != "succeeded" {
		t.Fatal("lost transitions", states)
	}
	close(release)
	if err := <-done; err != nil {
		t.Fatal(err)
	}
}
func TestObservationCancellationAndFailedSendDetachOnlyObserver(t *testing.T) {
	q := NewQueue()
	ctx := context.Background()
	job, err := q.Enqueue(ctx, operation.Request{Kind: "sync-courses"})
	if err != nil {
		t.Fatal(err)
	}
	canceled, cancel := context.WithCancel(ctx)
	cancel()
	if err := q.Observe(canceled, job.ID, func(operation.Job) error { t.Fatal("called canceled observer"); return nil }); !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
	disconnected := errors.New("connection closed")
	if err := q.Observe(ctx, job.ID, func(operation.Job) error { return disconnected }); !errors.Is(err, disconnected) {
		t.Fatal(err)
	}
	running, err := q.Claim(ctx)
	if err != nil || running == nil {
		t.Fatal("observer canceled work", err)
	}
	if err := q.Finish(ctx, *running, true, nil); err != nil {
		t.Fatal(err)
	}
}
