package browser

import workerproto "github.com/futsuuu/ku-potato/browser-worker/protocol"

type Failure workerproto.Failure

func (f *Failure) Error() string { return f.Message }

func Fail(reason workerproto.FailureReason, message string) error {
	return &Failure{Reason: reason, Message: message}
}

type DownloadResult struct {
	Snapshot            *workerproto.Snapshot
	Path, Filename, URL string
}
