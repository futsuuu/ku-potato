package filesystem

import (
	"errors"
	"io"
	"os"

	"github.com/klauspost/compress/zstd"
)

// zstdFile keeps decompression streaming while supporting the seeks required by
// http.ServeContent. SeekEnd uses the original size stored with the file.
type zstdFile struct {
	source         *os.File
	decoder        *zstd.Decoder
	compressedSize int64
	size           int64
	position       int64
	decodedPos     int64
}

func (f *zstdFile) Read(p []byte) (int, error) {
	if len(p) == 0 {
		return 0, nil
	}
	if f.position >= f.size {
		return 0, io.EOF
	}
	if f.position < f.decodedPos {
		if err := f.decoder.Reset(io.NewSectionReader(f.source, 0, f.compressedSize)); err != nil {
			return 0, err
		}
		f.decodedPos = 0
	}
	if f.position > f.decodedPos {
		n, err := io.CopyN(io.Discard, f.decoder, f.position-f.decodedPos)
		f.decodedPos += n
		if err != nil {
			return 0, err
		}
	}
	if int64(len(p)) > f.size-f.position {
		p = p[:int(f.size-f.position)]
	}
	n, err := f.decoder.Read(p)
	f.position += int64(n)
	f.decodedPos += int64(n)
	if err == io.EOF && f.position < f.size {
		err = io.ErrUnexpectedEOF
	}
	return n, err
}

func (f *zstdFile) Seek(offset int64, whence int) (int64, error) {
	var base int64
	switch whence {
	case io.SeekStart:
	case io.SeekCurrent:
		base = f.position
	case io.SeekEnd:
		base = f.size
	default:
		return 0, errors.New("invalid seek whence")
	}
	position := base + offset
	if position < 0 || (offset > 0 && position < base) || (offset < 0 && position > base) {
		return 0, errors.New("invalid seek offset")
	}
	f.position = position
	return position, nil
}

func (f *zstdFile) Close() error {
	f.decoder.Close()
	return f.source.Close()
}
