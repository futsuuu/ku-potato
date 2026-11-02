//go:build production

package launcher

import "testing"

func TestFindBinaryIgnoresDevelopmentDirectory(t *testing.T) {
	prepareDevelopmentBinary(t)
	if binary, err := findBinary(); err == nil || binary != "" {
		t.Fatalf("production lookup accepted development binary: %q, %v", binary, err)
	}
}
