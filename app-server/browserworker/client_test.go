package browserworker

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"path/filepath"
	"testing"

	"github.com/futsuuu/ku-potato/app-server/domain"
	workerproto "github.com/futsuuu/ku-potato/browser-worker/protocol"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/status"
	"google.golang.org/grpc/test/bufconn"
)

type fileWorker struct {
	workerproto.UnimplementedBrowserWorkerServer
	declared int64
}

func (w fileWorker) Download(
	_ *workerproto.DownloadRequest,
	stream workerproto.BrowserWorker_DownloadServer,
) error {
	header := &workerproto.DownloadHeader{
		Snapshot: &workerproto.Snapshot{
			MaterialId:   &workerproto.MaterialId{Value: "SRY1"},
			ResourceList: &workerproto.ResourceList{},
		},
		Outcome: &workerproto.DownloadHeader_File{
			File: &workerproto.FileDownload{Filename: "handout.pdf", ByteSize: w.declared},
		},
	}
	if err := stream.Send(
		&workerproto.DownloadPart{Part: &workerproto.DownloadPart_Header{Header: header}},
	); err != nil {
		return err
	}
	return stream.Send(
		&workerproto.DownloadPart{Part: &workerproto.DownloadPart_Chunk{Chunk: []byte("content")}},
	)
}

func TestStructuredFailureDoesNotDependOnMessageText(t *testing.T) {
	failure := &workerproto.Failure{
		Reason:  workerproto.FailureReason_FAILURE_REASON_AUTHENTICATION_REQUIRED,
		Message: "login: required",
	}
	st, err := status.New(codes.FailedPrecondition, "login: required").WithDetails(failure)
	if err != nil {
		t.Fatal(err)
	}
	var got *domain.Error
	if !errors.As(translate(st.Err()), &got) || got.Reason != "authentication-required" ||
		got.Message != "login: required" {
		t.Fatalf("failure lost its type: %v", got)
	}
}

func TestDownloadStreamsIntoLocalTemporaryFileAndRejectsTruncation(t *testing.T) {
	for _, size := range []int64{7, 8, -1} {
		t.Run(fmt.Sprint(size), func(t *testing.T) {
			listener := bufconn.Listen(1 << 20)
			server := grpc.NewServer()
			workerproto.RegisterBrowserWorkerServer(server, fileWorker{declared: size})
			go func() { _ = server.Serve(listener) }()
			defer server.Stop()
			conn, err := grpc.NewClient(
				"passthrough:///worker",
				grpc.WithTransportCredentials(insecure.NewCredentials()),
				grpc.WithContextDialer(
					func(context.Context, string) (net.Conn, error) { return listener.Dial() },
				),
			)
			if err != nil {
				t.Fatal(err)
			}
			defer func() { _ = conn.Close() }()
			root := t.TempDir()
			client := New(workerproto.NewBrowserWorkerClient(conn), nil, root)
			result, err := client.Download(context.Background(), "SRY1", "SRS1", "")
			if size != 7 {
				if err == nil || result.Path != "" {
					t.Fatalf("truncated transfer succeeded: %+v %v", result, err)
				}
				entries, _ := os.ReadDir(root)
				if len(entries) != 0 {
					t.Fatalf("partial file remained: %v", entries)
				}
				return
			}
			if err != nil || result.Snapshot.MaterialID != "SRY1" {
				t.Fatalf("download failed: %+v %v", result, err)
			}
			file, err := os.Open(filepath.Clean(result.Path))
			if err != nil {
				t.Fatal(err)
			}
			defer func() { _ = file.Close() }()
			body, err := io.ReadAll(file)
			if err != nil || string(body) != "content" {
				t.Fatalf("file contents: %q %v", body, err)
			}
		})
	}
}
