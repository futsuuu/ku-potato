package filesystem

import (
	"bytes"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/futsuuu/ku-potato/app-server/domain"
	"github.com/klauspost/compress/zstd"
)

func TestSaveRepairsCorruptContent(t *testing.T) {
	for _, first := range []string{"original.zip", "original.txt"} {
		corruptions := []string{"same size", "shorter", "longer", "empty", "truncated storage"}
		if !alreadyCompressed(first) {
			corruptions = append(corruptions, "invalid frame", "checksum")
		}
		for _, next := range []string{"renamed.zip", "renamed.txt"} {
			for _, corruption := range corruptions {
				t.Run(first+"/"+next+"/"+corruption, func(t *testing.T) {
					root := t.TempDir()
					files, err := New(filepath.Join(root, "files"))
					if err != nil {
						t.Fatal(err)
					}
					body := bytes.Repeat([]byte("healthy lecture notes\n"), 100)
					source := filepath.Join(root, "source")
					if err := os.WriteFile(source, body, 0o600); err != nil {
						t.Fatal(err)
					}
					original, err := files.Save(source, first)
					if err != nil {
						t.Fatal(err)
					}
					path, err := files.path(original)
					if err != nil {
						t.Fatal(err)
					}
					encode := func(content []byte) []byte {
						if alreadyCompressed(first) {
							return content
						}
						encoder, err := zstd.NewWriter(nil, zstd.WithEncoderCRC(true))
						if err != nil {
							t.Fatal(err)
						}
						defer func() { _ = encoder.Close() }()
						return encoder.EncodeAll(content, nil)
					}
					var damaged []byte
					switch corruption {
					case "same size":
						damaged = encode(bytes.Repeat([]byte("!"), len(body)))
					case "shorter":
						damaged = encode(body[:len(body)/2])
					case "longer":
						damaged = encode(append(bytes.Clone(body), 'x'))
					case "empty":
						damaged = encode(nil)
					case "truncated storage":
						damaged = encode(body)
						damaged = damaged[:len(damaged)/2]
					case "invalid frame":
						damaged = []byte("not a zstd frame")
					case "checksum":
						damaged = encode(body)
						damaged[len(damaged)-1] ^= 0xff
					}
					if err := os.WriteFile(path, damaged, 0o600); err != nil {
						t.Fatal(err)
					}
					// Repair must not depend on metadata cached by the previous instance.
					files, err = New(files.root)
					if err != nil {
						t.Fatal(err)
					}
					saved, err := files.Save(source, next)
					if err != nil || saved.ID != original.ID || saved.SHA256 != original.SHA256 ||
						saved.Size != original.Size || saved.OriginalFilename != next {
						t.Fatal(saved, err)
					}
					assertStoredOriginalContent(t, files, saved, body)
					// Existing resource associations must also read the repaired bytes.
					for _, metadata := range []domain.SavedFile{original, saved} {
						file, err := files.Open(metadata)
						if err != nil {
							t.Fatal(err)
						}
						actual, err := io.ReadAll(file)
						_ = file.Close()
						if err != nil || !bytes.Equal(actual, body) {
							t.Fatalf(
								"redownload retained corrupt content: length=%d, err=%v",
								len(actual),
								err,
							)
						}
					}
					entries, err := os.ReadDir(files.root)
					if err != nil || len(entries) != 1 {
						t.Fatal("temporary or stale encoding retained", entries, err)
					}
				})
			}
		}
	}
}

func TestFailedRepairPreservesExistingStorageAndRemovesTemporaryFile(t *testing.T) {
	root := t.TempDir()
	files, err := New(filepath.Join(root, "files"))
	if err != nil {
		t.Fatal(err)
	}
	source := filepath.Join(root, "source")
	if err := os.WriteFile(source, []byte("healthy content"), 0o600); err != nil {
		t.Fatal(err)
	}
	saved, err := files.Save(source, "original.zip")
	if err != nil {
		t.Fatal(err)
	}
	path, err := files.path(saved)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	// A nonempty directory makes replacement fail on every supported OS.
	if err := os.Mkdir(path, 0o700); err != nil {
		t.Fatal(err)
	}
	marker := filepath.Join(path, "keep")
	if err := os.WriteFile(marker, []byte("preserve"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := files.Save(source, "replacement.zip"); err == nil {
		t.Fatal("repair reported success despite failed publication")
	}
	if body, err := os.ReadFile(marker); err != nil || string(body) != "preserve" {
		t.Fatal("failed repair changed existing storage", string(body), err)
	}
	if entries, err := os.ReadDir(files.root); err != nil || len(entries) != 1 {
		t.Fatal("temporary file retained", entries, err)
	}
}

// Open bounds reads by metadata.Size, so inspect storage directly to catch
// oversized compressed content and errors after the expected original bytes.
func assertStoredOriginalContent(t *testing.T, files *Files, saved domain.SavedFile, want []byte) {
	t.Helper()
	path, err := files.path(saved)
	if err != nil {
		t.Fatal(err)
	}
	body, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if strings.HasSuffix(path, zstdSuffix) {
		decoder, err := zstd.NewReader(nil)
		if err != nil {
			t.Fatal(err)
		}
		defer decoder.Close()
		body, err = decoder.DecodeAll(body, nil)
		if err != nil {
			t.Fatal(err)
		}
	}
	if !bytes.Equal(body, want) {
		t.Fatalf("stored content differs: length=%d, want=%d", len(body), len(want))
	}
}
