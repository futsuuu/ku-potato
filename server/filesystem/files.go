package filesystem

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"os"
	"path/filepath"
	"regexp"

	"github.com/futsuuu/ku-potato/server/core/outport"
	"github.com/futsuuu/ku-potato/server/domain"
)

type Files struct{ root string }

var _ outport.Files = (*Files)(nil)

func New(root string) (*Files, error) {
	root, err := filepath.Abs(root)
	if err != nil {
		return nil, err
	}
	if err = os.MkdirAll(root, 0700); err != nil {
		return nil, err
	}
	return &Files{root}, nil
}

var blobID = regexp.MustCompile(`^[a-f0-9]{32}$`)

func (f *Files) path(file domain.SavedFile) (string, error) {
	if !blobID.MatchString(file.ID) {
		return "", domain.Fail("resource-storage", "invalid saved file identity")
	}
	return filepath.Join(f.root, file.ID), nil
}
func (f *Files) Save(source, filename string) (domain.SavedFile, error) {
	in, err := os.Open(source)
	if err != nil {
		return domain.SavedFile{}, err
	}
	defer in.Close()
	id := make([]byte, 16)
	if _, err = rand.Read(id); err != nil {
		return domain.SavedFile{}, err
	}
	metadata := domain.SavedFile{ID: hex.EncodeToString(id), OriginalFilename: filename}
	destination := filepath.Join(f.root, metadata.ID)
	out, err := os.OpenFile(destination, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return metadata, err
	}
	success := false
	defer func() {
		out.Close()
		if !success {
			os.Remove(destination)
		}
	}()
	hash := sha256.New()
	metadata.Size, err = io.Copy(io.MultiWriter(out, hash), in)
	if err != nil {
		return metadata, err
	}
	if err = out.Sync(); err != nil {
		return metadata, err
	}
	if err = out.Close(); err != nil {
		return metadata, err
	}
	metadata.SHA256 = hex.EncodeToString(hash.Sum(nil))
	success = true
	return metadata, nil
}
func (f *Files) Open(file domain.SavedFile) (io.ReadSeekCloser, error) {
	path, err := f.path(file)
	if err != nil {
		return nil, err
	}
	in, err := os.Open(path)
	if os.IsNotExist(err) {
		return nil, domain.ErrMissing
	}
	return in, err
}
func (f *Files) Remove(file domain.SavedFile) error {
	path, err := f.path(file)
	if err != nil {
		return err
	}
	err = os.Remove(path)
	if os.IsNotExist(err) {
		return nil
	}
	return err
}
func (f *Files) Discard(path string) error { return os.Remove(path) }
