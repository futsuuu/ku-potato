package processlifetime

import (
	"errors"
	"os"
	"sync"
	"time"
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
	var once sync.Once
	return func() {
		once.Do(func() {
			// Job termination is asynchronous. Wait for each process handle,
			// not just the job's active count, before reusing its profile.
			handles := jobProcessHandles(job)
			_ = windows.TerminateJobObject(job, 1)
			deadline := time.Now().Add(5 * time.Second)
			for _, handle := range handles {
				remaining := max(time.Until(deadline).Milliseconds(), 0)
				_, _ = windows.WaitForSingleObject(handle, uint32(remaining))
				_ = windows.CloseHandle(handle)
			}
			closeJob()
		})
	}, nil
}

// JOBOBJECT_BASIC_PROCESS_ID_LIST has a variable-sized trailing array.
type jobProcessList struct {
	Assigned uint32
	Count    uint32
	IDs      [1]uintptr
}

func jobProcessHandles(job windows.Handle) []windows.Handle {
	for capacity := 32; ; capacity *= 2 {
		size := int(unsafe.Offsetof(jobProcessList{}.IDs)) + capacity*int(unsafe.Sizeof(uintptr(0)))
		buffer := make([]byte, size)
		list := (*jobProcessList)(unsafe.Pointer(&buffer[0]))
		err := windows.QueryInformationJobObject(job, windows.JobObjectBasicProcessIdList,
			uintptr(unsafe.Pointer(list)), uint32(size), nil)
		if errors.Is(err, windows.ERROR_MORE_DATA) {
			continue
		}
		if err != nil {
			return nil
		}
		var handles []windows.Handle
		for _, pid := range unsafe.Slice(&list.IDs[0], list.Count) {
			handle, err := windows.OpenProcess(windows.SYNCHRONIZE, false, uint32(pid))
			if err == nil {
				handles = append(handles, handle)
			}
		}
		return handles
	}
}
