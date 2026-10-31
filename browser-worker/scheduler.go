package browserworker

import (
	"context"
	"errors"
	"sync"
	"time"

	"github.com/futsuuu/ku-potato/browser-worker/browser"
	workerproto "github.com/futsuuu/ku-potato/browser-worker/protocol"
)

type result struct {
	value any
	err   error
}
type task struct {
	ctx    context.Context
	cancel context.CancelFunc
	key    string
	run    func(context.Context) (any, error)
	done   chan struct{}
	result result
}

type Scheduler struct {
	root   context.Context
	queue  chan *task
	mu     sync.Mutex
	active map[string]*task
}

func NewScheduler(ctx context.Context, workers int) *Scheduler {
	s := &Scheduler{root: ctx, queue: make(chan *task, 256), active: make(map[string]*task)}
	for range max(1, workers) {
		go s.work()
	}
	return s
}

func (s *Scheduler) work() {
	for {
		select {
		case <-s.root.Done():
			return
		case t := <-s.queue:
			if err := t.ctx.Err(); err != nil {
				t.result.err = err
			} else {
				for attempt := 0; attempt < 3; attempt++ {
					t.result.value, t.result.err = t.run(t.ctx)
					var failure *browser.Failure
					if t.key == "" || t.ctx.Err() != nil || attempt == 2 || !errors.As(t.result.err, &failure) || failure.Reason != workerproto.FailureReason_FAILURE_REASON_SOURCE {
						break
					}
					select {
					case <-t.ctx.Done():
					case <-time.After(time.Duration(attempt+1) * 2 * time.Second):
					}
				}
			}
			t.cancel()
			s.mu.Lock()
			if t.key != "" {
				delete(s.active, t.key)
			}
			close(t.done)
			s.mu.Unlock()
		}
	}
}

func (s *Scheduler) Run(ctx context.Context, key string, run func(context.Context) (any, error)) (any, error) {
	s.mu.Lock()
	t := s.active[key]
	if key == "" || t == nil {
		var execution context.Context
		var cancel context.CancelFunc
		if key == "" {
			execution, cancel = context.WithCancel(ctx)
		} else {
			execution, cancel = context.WithTimeout(s.root, 2*time.Minute)
		}
		t = &task{ctx: execution, cancel: cancel, key: key, run: run, done: make(chan struct{})}
		select {
		case s.queue <- t:
			if key != "" {
				s.active[key] = t
			}
		default:
			cancel()
			s.mu.Unlock()
			return nil, browser.Fail(workerproto.FailureReason_FAILURE_REASON_SOURCE, "ブラウザワーカーが混雑しています。")
		}
	}
	s.mu.Unlock()
	select {
	case <-ctx.Done():
		if key == "" {
			select {
			case <-t.done:
				return t.result.value, ctx.Err()
			case <-s.root.Done():
				return nil, s.root.Err()
			}
		}
		return nil, ctx.Err()
	case <-s.root.Done():
		return nil, s.root.Err()
	case <-t.done:
		return t.result.value, t.result.err
	}
}
