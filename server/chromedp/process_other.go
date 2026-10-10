//go:build !windows

package chromedp

import "os"

func manageProcess(*os.Process) (func(), error) { return func() {}, nil }
