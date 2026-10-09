package core

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/futsuuu/ku-potato/server/core/outport"
	"github.com/futsuuu/ku-potato/server/domain"
)

type parallelSource struct {
	outport.Source
	entered chan string
	release chan struct{}
}

func (s *parallelSource) Materials(ctx context.Context, id string) (domain.Snapshot, error) {
	s.entered <- id
	select {
	case <-ctx.Done():
		return domain.Snapshot{}, ctx.Err()
	case <-s.release:
	}
	return domain.Snapshot{Materials: &domain.CourseMaterials{CourseID: id, Folders: []domain.Folder{}}}, nil
}

type materialArchive struct {
	outport.Archive
	mu     sync.Mutex
	values map[string]domain.CourseMaterials
}

func (s *materialArchive) Append(_ context.Context, snapshot domain.Snapshot) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.values[snapshot.Materials.CourseID] = *snapshot.Materials
	return nil
}
func (s *materialArchive) Materials(_ context.Context, id string) (domain.CourseMaterials, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.values[id], nil
}

type authState struct{}

func (authState) Auth(context.Context) (domain.AuthState, error) { return domain.AuthState{}, nil }
func (authState) SetAuth(context.Context, string) error          { return nil }

func TestMaterialsBatchRunsInParallelAndKeepsInputOrder(t *testing.T) {
	source := &parallelSource{entered: make(chan string, 2), release: make(chan struct{})}
	archive := &materialArchive{values: make(map[string]domain.CourseMaterials)}
	app := New(source, archive, authState{}, nil, nil, time.Second, 2)
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	progress := []domain.Progress{}
	ctx = withProgress(ctx, func(p domain.Progress) { progress = append(progress, p) })
	done := make(chan error, 1)
	go func() {
		result, err := app.parallelMaterials(ctx, []string{"KOG2", "KOG1"})
		if err == nil && (len(result.CourseMaterials) != 2 || result.CourseMaterials[0].CourseID != "KOG2" || result.CourseMaterials[1].CourseID != "KOG1") {
			t.Error("result order changed", result)
		}
		done <- err
	}()
	for range 2 {
		select {
		case <-source.entered:
		case <-ctx.Done():
			t.Fatal("course operations did not overlap")
		}
	}
	close(source.release)
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	if len(progress) != 3 || progress[0].Total != 2 || progress[1].Completed != 1 || progress[2].Completed != 2 || progress[2].Total != 2 {
		t.Fatal("incorrect progress", progress)
	}
}
