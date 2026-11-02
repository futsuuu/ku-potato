//go:build !production

package launcher

import "testing"

func TestFindBinaryUsesDevelopmentDirectory(t *testing.T) {
	want := prepareDevelopmentBinary(t)
	binary, err := findBinary()
	if err != nil || binary != want {
		t.Fatalf("development binary lookup: got %q, %v; want %q", binary, err, want)
	}
}
