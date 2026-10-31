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

// Opener reuses decoded copies for the lifetime of the server process.
// Old sessions are removed on the next server start, never when the viewer starts.
type Opener struct {
	root   string
	launch func(string) error
	copies sync.Map // saved file ID + filename -> *openedCopy
}

type openedCopy struct {
	mu       sync.Mutex
	path     string
	modified time.Time
}

var _ outport.ResourceOpener = (*Opener)(nil)

func NewOpener(temp string) (*Opener, error) {
	root := filepath.Join(temp, "ku-potato-opened-resources")
	if err := os.MkdirAll(root, 0700); err != nil {
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
	return &Opener{root: session, launch: openDefault}, nil
}

func (o *Opener) Open(ctx context.Context, content io.Reader, saved domain.SavedFile) error {
	copy, _ := o.copies.LoadOrStore(saved.ID+"\x00"+saved.OriginalFilename, &openedCopy{})
	entry := copy.(*openedCopy)
	entry.mu.Lock()
	defer entry.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return err
	}
	if entry.path != "" {
		if stat, err := os.Stat(entry.path); err == nil && stat.Mode().IsRegular() && stat.Size() == saved.Size && stat.ModTime().Equal(entry.modified) {
			return o.launch(entry.path)
		}
	}
	name := filepath.Base(strings.ReplaceAll(saved.OriginalFilename, "\\", "/"))
	if name == "" || name == "." || name == ".." || name == "/" || strings.ContainsAny(name, "\x00:") {
		name = "resource"
	}
	dir, err := os.MkdirTemp(o.root, "file-")
	if err != nil {
		return err
	}
	success := false
	defer func() {
		if !success {
			_ = os.RemoveAll(dir)
		}
	}()
	path := filepath.Join(dir, name)
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return err
	}
	size, copyErr := io.Copy(file, content)
	closeErr := file.Close()
	if copyErr != nil {
		return copyErr
	}
	if closeErr != nil {
		return closeErr
	}
	if size != saved.Size {
		return fmt.Errorf("saved file size changed: expected %d, got %d", saved.Size, size)
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	stat, err := os.Stat(path)
	if err != nil {
		return err
	}
	if err := o.launch(path); err != nil {
		return err
	}
	entry.path, entry.modified = path, stat.ModTime()
	success = true
	return nil
}
