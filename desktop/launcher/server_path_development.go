//go:build !production

package launcher

import "path/filepath"

func developmentBinaryDirectories() []string {
	return []string{filepath.Join("desktop", "build", "bin")}
}
