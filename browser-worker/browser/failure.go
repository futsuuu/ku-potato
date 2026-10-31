package browser

import workerproto "github.com/futsuuu/ku-potato/browser-worker/protocol"

type Failure struct {
	Reason  workerproto.FailureReason
	Message string
}

func (f *Failure) Error() string { return f.Message }

func Fail(reason workerproto.FailureReason, message string) error {
	return &Failure{Reason: reason, Message: message}
}

type DownloadResult struct {
	Snapshot            *workerproto.Snapshot
	Path, Filename, URL string
}
