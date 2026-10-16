package filesystem

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/futsuuu/ku-potato/server/core/outport"
	"github.com/futsuuu/ku-potato/server/domain"
	"github.com/klauspost/compress/zstd"
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

const zstdSuffix = ".zst"

func alreadyCompressed(filename string) bool {
	switch strings.ToLower(filepath.Ext(filename)) {
	case ".zip", ".7z", ".rar", ".gz", ".bz2", ".xz", ".zst",
		".docx", ".xlsx", ".pptx",
		".jpg", ".jpeg", ".png", ".gif", ".webp", ".mp3", ".mp4":
		return true
	default:
		return false
	}
}

func (f *Files) path(file domain.SavedFile) (string, error) {
	id := strings.TrimSuffix(file.ID, zstdSuffix)
	if !blobID.MatchString(id) {
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
	if !alreadyCompressed(filename) {
		metadata.ID += zstdSuffix
	}
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
	var writer io.Writer = out
	var encoder *zstd.Encoder
	if strings.HasSuffix(metadata.ID, zstdSuffix) {
		encoder, err = zstd.NewWriter(out, zstd.WithEncoderLevel(zstd.SpeedDefault))
		if err != nil {
			return metadata, err
		}
		writer = encoder
	}
	hash := sha256.New()
	metadata.Size, err = io.Copy(io.MultiWriter(writer, hash), in)
	if err != nil {
		if encoder != nil {
			_ = encoder.Close()
		}
		return metadata, err
	}
	if encoder != nil {
		if err = encoder.Close(); err != nil {
			return metadata, err
		}
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
	if err != nil || !strings.HasSuffix(file.ID, zstdSuffix) {
		return in, err
	}
	stat, err := in.Stat()
	if err != nil {
		in.Close()
		return nil, err
	}
	decoder, err := zstd.NewReader(io.NewSectionReader(in, 0, stat.Size()))
	if err != nil {
		in.Close()
		return nil, err
	}
	return &zstdFile{source: in, decoder: decoder, compressedSize: stat.Size(), size: file.Size}, nil
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
