package filesystem

import (
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/futsuuu/ku-potato/server/domain"
)

func TestSaveUsesOpaqueIdentityAndVerifiesBytes(t *testing.T) {
	dir := t.TempDir()
	files, err := New(filepath.Join(dir, "resources"))
	if err != nil {
		t.Fatal(err)
	}
	source := filepath.Join(dir, "download")
	if err = os.WriteFile(source, []byte("hello"), 0600); err != nil {
		t.Fatal(err)
	}
	saved, err := files.Save(source, "../../CON.txt")
	if err != nil {
		t.Fatal(err)
	}
	if saved.Size != 5 || saved.SHA256 != "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824" {
		t.Fatal(saved)
	}
	file, err := files.Open(saved)
	if err != nil {
		t.Fatal(err)
	}
	body, err := io.ReadAll(file)
	file.Close()
	if err != nil || string(body) != "hello" {
		t.Fatal(string(body), err)
	}
	if _, err = files.Open(domain.SavedFile{ID: strings.Repeat("../", 10)}); err == nil {
		t.Fatal("accepted traversal")
	}
	if err = files.Remove(saved); err != nil {
		t.Fatal(err)
	}
}
