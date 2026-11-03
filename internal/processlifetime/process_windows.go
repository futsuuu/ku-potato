package processlifetime

import (
	"os"
	"unsafe"

	"golang.org/x/sys/windows"
)

func BindToParent(process *os.Process) (func(), error) {
	job, err := windows.CreateJobObject(nil, nil)
	if err != nil {
		return nil, err
	}
	closeJob := func() { _ = windows.CloseHandle(job) }
	info := windows.JOBOBJECT_EXTENDED_LIMIT_INFORMATION{}
	info.BasicLimitInformation.LimitFlags = windows.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
	if _, err := windows.SetInformationJobObject(
		job,
		windows.JobObjectExtendedLimitInformation,
		uintptr(unsafe.Pointer(&info)),
		uint32(unsafe.Sizeof(info)),
	); err != nil {
		closeJob()
		return nil, err
	}
	handle, err := windows.OpenProcess(
		windows.PROCESS_SET_QUOTA|windows.PROCESS_TERMINATE,
		false,
		uint32(process.Pid),
	)
	if err != nil {
		closeJob()
		return nil, err
	}
	defer func() { _ = windows.CloseHandle(handle) }()
	if err := windows.AssignProcessToJobObject(job, handle); err != nil {
		closeJob()
		return nil, err
	}
	return closeJob, nil
}
