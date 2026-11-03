package application

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/futsuuu/ku-potato/app-server/application/operation"
	"github.com/futsuuu/ku-potato/app-server/application/outport"
	"github.com/futsuuu/ku-potato/app-server/domain"
)

type stalledSource struct{ outport.ContentSource }

func (stalledSource) Materials(ctx context.Context, _ string) (domain.Snapshot, error) {
	<-ctx.Done()
	return domain.Snapshot{}, ctx.Err()
}

func TestBatchTimeoutIsNotReportedAsSuccessfulPartialResult(t *testing.T) {
	app := New(stalledSource{}, nil, nil, nil, time.Millisecond, 2)
	ctx, cancel := context.WithTimeout(context.Background(), time.Millisecond)
	defer cancel()
	_, err := app.execute(
		ctx,
		operation.Request{Kind: "sync-materials", CourseIDs: []string{"KOG1", "KOG2"}},
	)
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("swallowed deadline: %v", err)
	}
}

func TestRequestValidationRejectsConflictingJobInputs(t *testing.T) {
	for _, r := range []operation.Request{
		{Kind: "unknown"},
		{Kind: "sync-resources", MaterialID: "SRY1');alert(1)"},
		{Kind: "download-resource", MaterialID: "SRY1", ResourceID: "../file"},
		{Kind: "sync-courses", Interactive: true},
		{Kind: "delete-webauthn", MaterialID: "SRY1"},
		{Kind: "login", CourseIDs: []string{"KOG1"}},
		{Kind: "sync-resources", MaterialID: "SRY1", ResourceID: "SRS1"},
	} {
		if err := validateJobRequest(r); err == nil {
			t.Fatalf("accepted invalid request: %#v", r)
		}
	}
	if err := validateJobRequest(
		operation.Request{Kind: "download-resource", MaterialID: "SRY1", ResourceID: "SRS1"},
	); err != nil {
		t.Fatal(err)
	}
}

type gatedSource struct {
	outport.LMSAuthentication
	*parallelSource
	loginEntered chan struct{}
	loginRelease chan struct{}
}

func (s *gatedSource) Login(ctx context.Context, _ bool) error {
	close(s.loginEntered)
	select {
	case <-s.loginRelease:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

type loginIdentity struct {
	outport.LMSAuthentication
	called bool
}

func (i *loginIdentity) Login(context.Context, bool) error {
	i.called = true
	return nil
}

func TestAuthenticationUsesDedicatedIdentityPort(t *testing.T) {
	identity := &loginIdentity{}
	app := New(
		stalledSource{},
		nil,
		authState{},
		nil,
		time.Second,
		1,
		WithLMSAuthentication(identity),
	)
	if _, err := app.execute(
		context.Background(),
		operation.Request{Kind: "login"},
	); err != nil ||
		!identity.called {
		t.Fatal("login did not use the injected identity port", err)
	}
}

func TestAuthenticationWaitsForNormalJobsAndExcludesNewJobs(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	source := &gatedSource{
		parallelSource: &parallelSource{
			entered: make(chan string, 2),
			release: make(chan struct{}),
		},
		loginEntered: make(chan struct{}),
		loginRelease: make(chan struct{}),
	}
	app := New(
		source,
		&materialArchive{values: map[string]domain.CourseMaterials{}},
		authState{},
		nil,
		time.Second,
		2,
	)
	done := make(chan error, 3)
	materials := func(id string) {
		_, err := app.executeJob(
			ctx,
			operation.Request{Kind: "sync-materials", CourseIDs: []string{id}},
		)
		done <- err
	}
	go materials("KOG1")
	go materials("KOG2")
	for range 2 {
		select {
		case <-source.entered:
		case <-ctx.Done():
			t.Fatal("normal jobs did not overlap")
		}
	}
	go func() { _, err := app.executeJob(ctx, operation.Request{Kind: "login"}); done <- err }()
	select {
	case <-source.loginEntered:
		t.Fatal("authentication overlapped active normal jobs")
	case <-time.After(50 * time.Millisecond):
	}
	close(source.release)
	for range 2 {
		if err := <-done; err != nil {
			t.Fatal(err)
		}
	}
	select {
	case <-source.loginEntered:
	case <-ctx.Done():
		t.Fatal("authentication did not start after normal jobs ended")
	}
	go materials("KOG3")
	select {
	case <-source.entered:
		t.Fatal("normal job overlapped authentication")
	case <-time.After(50 * time.Millisecond):
	}
	close(source.loginRelease)
	for range 2 {
		if err := <-done; err != nil {
			t.Fatal(err)
		}
	}
}
