package filesystem

import (
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/futsuuu/ku-potato/app-server/application/outport"
	"github.com/futsuuu/ku-potato/app-server/domain"
)

type Materializer struct {
	root   string
	copies sync.Map
}

type openedCopy struct {
	mu       sync.Mutex
	path     string
	modified time.Time
}

var _ outport.ResourceMaterializer = (*Materializer)(nil)

func NewMaterializer(temp string) (*Materializer, error) {
	root := filepath.Join(temp, "ku-potato-opened-resources")
	if err := os.MkdirAll(root, 0o700); err != nil {
		return nil, err
	}
	entries, _ := os.ReadDir(root)
	for _, entry := range entries {
		// On Windows a viewer may still have a file open. Cleanup is best-effort.
		if entry.IsDir() && strings.HasPrefix(entry.Name(), "session-") {
			_ = os.RemoveAll(filepath.Join(root, entry.Name()))
		}
	}
	session, err := os.MkdirTemp(root, "session-")
	if err != nil {
		return nil, err
	}
	return &Materializer{root: session}, nil
}

func (o *Materializer) Prepare(
	ctx context.Context,
	content io.Reader,
	saved domain.SavedFile,
) (string, error) {
	copy, _ := o.copies.LoadOrStore(saved.ID+"\x00"+saved.OriginalFilename, &openedCopy{})
	entry := copy.(*openedCopy)
	entry.mu.Lock()
	defer entry.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return "", err
	}
	if entry.path != "" {
		if stat, err := os.Stat(entry.path); err == nil &&
			stat.Mode().IsRegular() && stat.Size() == saved.Size &&
			stat.ModTime().Equal(entry.modified) {
			return entry.path, nil
		}
	}
	name := filepath.Base(strings.ReplaceAll(saved.OriginalFilename, "\\", "/"))
	if name == "" || name == "." || name == ".." || name == "/" ||
		strings.ContainsAny(name, "\x00:") {
		name = "resource"
	}
	dir, err := os.MkdirTemp(o.root, "file-")
	if err != nil {
		return "", err
	}
	success := false
	defer func() {
		if !success {
			_ = os.RemoveAll(dir)
		}
	}()
	path := filepath.Join(dir, name)
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return "", err
	}
	size, copyErr := io.Copy(file, content)
	closeErr := file.Close()
	if copyErr != nil {
		return "", copyErr
	}
	if closeErr != nil {
		return "", closeErr
	}
	if size != saved.Size {
		return "", fmt.Errorf("saved file size changed: expected %d, got %d", saved.Size, size)
	}
	if err := ctx.Err(); err != nil {
		return "", err
	}
	stat, err := os.Stat(path)
	if err != nil {
		return "", err
	}
	entry.path, entry.modified = path, stat.ModTime()
	success = true
	return path, nil
}
