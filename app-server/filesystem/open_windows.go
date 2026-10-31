package filesystem

import "golang.org/x/sys/windows"

func openDefault(path string) error {
	file, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return err
	}
	// Let Windows use the file association or prompt for an application.
	return windows.ShellExecute(0, nil, file, nil, nil, windows.SW_SHOWNORMAL)
}
