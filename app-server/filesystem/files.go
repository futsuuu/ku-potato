package filesystem

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"

	"github.com/futsuuu/ku-potato/app-server/application/outport"
	"github.com/futsuuu/ku-potato/app-server/domain"
	"github.com/klauspost/compress/zstd"
)

type Files struct {
	root string
	mu   sync.Mutex
}

var _ outport.Files = (*Files)(nil)

func New(root string) (*Files, error) {
	root, err := filepath.Abs(root)
	if err != nil {
		return nil, err
	}
	if err = os.MkdirAll(root, 0o700); err != nil {
		return nil, err
	}
	return &Files{root: root}, nil
}

var blobID = regexp.MustCompile(`^[a-f0-9]{64}$`)

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

// The identity is always the hash of original bytes. Encoding is local and
// determined by the stored name, never by OriginalFilename or the shared ID.
func (f *Files) path(file domain.SavedFile) (string, error) {
	if !blobID.MatchString(file.ID) {
		return "", domain.Fail("resource-storage", "invalid saved file identity")
	}
	for _, suffix := range []string{"", zstdSuffix} {
		path := filepath.Join(f.root, file.ID+suffix)
		if _, err := os.Stat(path); err == nil {
			return path, nil
		} else if !os.IsNotExist(err) {
			return "", err
		}
	}
	return "", domain.ErrMissing
}

func (f *Files) Save(source, filename string) (domain.SavedFile, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	in, err := os.Open(source)
	if err != nil {
		return domain.SavedFile{}, err
	}
	defer func() { _ = in.Close() }()
	out, err := os.CreateTemp(f.root, ".saving-")
	if err != nil {
		return domain.SavedFile{}, err
	}
	defer func() { _ = out.Close(); _ = os.Remove(out.Name()) }()
	metadata := domain.SavedFile{OriginalFilename: filename}
	suffix := ""
	var writer io.Writer = out
	var encoder *zstd.Encoder
	if !alreadyCompressed(filename) {
		suffix = zstdSuffix
		encoder, err = zstd.NewWriter(out, zstd.WithEncoderLevel(zstd.SpeedDefault))
		if err != nil {
			return metadata, err
		}
		writer = encoder
	}
	hash := sha256.New()
	metadata.Size, err = io.Copy(io.MultiWriter(writer, hash), in)
	if encoder != nil {
		closeErr := encoder.Close()
		if err == nil {
			err = closeErr
		}
	}
	if err != nil {
		return metadata, err
	}
	metadata.ID = hex.EncodeToString(hash.Sum(nil))
	metadata.SHA256 = metadata.ID
	if err := out.Sync(); err != nil {
		return metadata, err
	}
	if err := out.Close(); err != nil {
		return metadata, err
	}
	target := filepath.Join(f.root, metadata.ID+suffix)
	path, err := f.path(metadata)
	if err != nil && !errors.Is(err, domain.ErrMissing) {
		return metadata, err
	}
	// Reuse healthy content; publish the completed temporary file otherwise.
	if err == nil && storedContentMatches(path, metadata) {
		return metadata, nil
	}
	if err := os.Rename(out.Name(), target); err != nil {
		return metadata, err
	}
	// A different encoding must not shadow the repaired file during Open.
	// Save and Open hold mu throughout publication and removal.
	if path != "" && path != target {
		if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
			return metadata, err
		}
	}
	return metadata, nil
}

func storedContentMatches(path string, expected domain.SavedFile) bool {
	in, err := os.Open(path)
	if err != nil {
		return false
	}
	defer func() { _ = in.Close() }()
	var reader io.Reader = in
	if strings.HasSuffix(path, zstdSuffix) {
		decoder, err := zstd.NewReader(in, zstd.WithDecoderConcurrency(1))
		if err != nil {
			return false
		}
		defer decoder.Close()
		reader = decoder
	}
	hash := sha256.New()
	// Read beyond the expected end to reject oversized content and validate
	// the zstd trailer, without expanding an arbitrarily large corrupt file.
	size, err := io.Copy(hash, io.LimitReader(reader, expected.Size+1))
	return err == nil && size == expected.Size && hex.EncodeToString(hash.Sum(nil)) == expected.ID
}

func (f *Files) Open(file domain.SavedFile) (io.ReadSeekCloser, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	path, err := f.path(file)
	if err != nil {
		return nil, err
	}
	in, err := os.Open(path)
	if os.IsNotExist(err) {
		return nil, domain.ErrMissing
	}
	if err != nil || !strings.HasSuffix(path, zstdSuffix) {
		return in, err
	}
	stat, err := in.Stat()
	if err != nil {
		_ = in.Close()
		return nil, err
	}
	decoder, err := zstd.NewReader(io.NewSectionReader(in, 0, stat.Size()))
	if err != nil {
		_ = in.Close()
		return nil, err
	}
	return &zstdFile{
		source:         in,
		decoder:        decoder,
		compressedSize: stat.Size(),
		size:           file.Size,
	}, nil
}

// Remove must only be called after the archive has no references to this ID.
func (f *Files) Remove(file domain.SavedFile) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if !blobID.MatchString(file.ID) {
		return domain.Fail("resource-storage", "invalid saved file identity")
	}
	for _, suffix := range []string{"", zstdSuffix} {
		if err := os.Remove(
			filepath.Join(f.root, file.ID+suffix),
		); err != nil &&
			!os.IsNotExist(err) {
			return err
		}
	}
	return nil
}
func (f *Files) Discard(path string) error { return os.Remove(path) }
