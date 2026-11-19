package browserworker

import (
	"context"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/futsuuu/ku-potato/browser-worker/browser"
	workerproto "github.com/futsuuu/ku-potato/browser-worker/protocol"
	"go.opentelemetry.io/otel/trace"
)

func TestSourceFailureRetriesOnlyInsideWorker(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	s := NewScheduler(ctx, 1)
	calls := 0
	value, err := s.Run(ctx, "courses", func(context.Context) (any, error) {
		calls++
		if calls == 1 {
			return nil, browser.Fail(workerproto.FailureReason_FAILURE_REASON_SOURCE, "transient")
		}
		return "retrieved", nil
	})
	if err != nil || value != "retrieved" || calls != 2 {
		t.Fatalf("worker did not retry: %v %v (%d calls)", value, err, calls)
	}
}

func TestScheduledReadPreservesTraceWithoutRequestCancellation(t *testing.T) {
	root, stop := context.WithCancel(t.Context())
	defer stop()
	s := NewScheduler(root, 1)
	parent := trace.NewSpanContext(trace.SpanContextConfig{
		TraceID:    trace.TraceID{1},
		SpanID:     trace.SpanID{2},
		TraceFlags: trace.FlagsSampled,
	})
	request, cancel := context.WithCancel(trace.ContextWithSpanContext(root, parent))
	started := make(chan struct{})
	finished := make(chan struct{})
	executed := make(chan struct{})
	go func() {
		defer close(finished)
		_, _ = s.Run(request, "courses", func(ctx context.Context) (any, error) {
			defer close(executed)
			close(started)
			<-request.Done()
			if ctx.Err() != nil {
				t.Error("request cancellation canceled shared execution")
			}
			if trace.SpanContextFromContext(ctx).TraceID() != parent.TraceID() {
				t.Error("shared execution lost the request trace")
			}
			return nil, nil
		})
	}()
	<-started
	cancel()
	<-finished
	<-executed
}

func TestDownloadIsNotRetried(t *testing.T) {
	s := NewScheduler(context.Background(), 1)
	calls := 0
	_, err := s.Run(context.Background(), "", func(context.Context) (any, error) {
		calls++
		return nil, browser.Fail(workerproto.FailureReason_FAILURE_REASON_SOURCE, "download failed")
	})
	if err == nil || calls != 1 {
		t.Fatalf("download retried: %v (%d calls)", err, calls)
	}
}

func TestInFlightReadSharesExecutionButNotCompletedResults(t *testing.T) {
	ctx := t.Context()
	s := NewScheduler(ctx, 2)
	started := make(chan struct{})
	release := make(chan struct{})
	var calls atomic.Int32
	run := func(context.Context) (any, error) {
		if calls.Add(1) == 1 {
			close(started)
		}
		<-release
		return "result", nil
	}
	var wg sync.WaitGroup
	for range 2 {
		wg.Go(func() {
			value, err := s.Run(ctx, "courses", run)
			if err != nil || value != "result" {
				t.Errorf("run: %v %v", value, err)
			}
		})
	}
	<-started
	time.Sleep(10 * time.Millisecond)
	close(release)
	wg.Wait()
	if calls.Load() != 1 {
		t.Fatalf("overlapping reads ran %d times", calls.Load())
	}
	if _, err := s.Run(ctx, "courses", run); err != nil || calls.Load() != 2 {
		t.Fatal("completed result was reused", err)
	}
}
