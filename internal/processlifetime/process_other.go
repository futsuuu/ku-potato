//go:build !windows

package processlifetime

import "os"

func BindToParent(*os.Process) (func(), error) { return func() {}, nil }
