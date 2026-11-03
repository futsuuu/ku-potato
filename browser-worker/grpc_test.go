package browserworker

import (
	"context"
	"errors"
	"io"
	"net"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/futsuuu/ku-potato/browser-worker/browser"
	workerproto "github.com/futsuuu/ku-potato/browser-worker/protocol"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/status"
	"google.golang.org/grpc/test/bufconn"
	"google.golang.org/protobuf/types/known/emptypb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type fakeSource struct {
	mu    sync.Mutex
	calls int
	path  string
	fail  error
}

func (s *fakeSource) Courses(context.Context) (*workerproto.CourseListing, error) {
	s.mu.Lock()
	s.calls++
	s.mu.Unlock()
	return &workerproto.CourseListing{
		AcademicYear: 2026,
		Courses: []*workerproto.Course{
			{
				Name: "course",
				Access: &workerproto.Course_Available{
					Available: &workerproto.CourseId{Value: "KOG1"},
				},
				Schedule: &workerproto.Course_UnknownSchedule{UnknownSchedule: &emptypb.Empty{}},
			},
		},
	}, nil
}

func (*fakeSource) Materials(context.Context, string) (*workerproto.Snapshot, error) {
	return &workerproto.Snapshot{
		MaterialId:   &workerproto.MaterialId{Value: "SRY1"},
		ResourceList: &workerproto.ResourceList{},
	}, nil
}

func (*fakeSource) Resources(context.Context, string, string) (*workerproto.Snapshot, error) {
	return &workerproto.Snapshot{
		MaterialId:   &workerproto.MaterialId{Value: "SRY1"},
		ResourceList: &workerproto.ResourceList{},
	}, nil
}

func (s *fakeSource) Download(
	context.Context,
	string,
	string,
	string,
) (browser.DownloadResult, error) {
	if s.fail != nil {
		return browser.DownloadResult{}, s.fail
	}
	return browser.DownloadResult{
		Snapshot: &workerproto.Snapshot{
			MaterialId:   &workerproto.MaterialId{Value: "SRY1"},
			ResourceList: &workerproto.ResourceList{},
		},
		Path:     s.path,
		Filename: "handout.pdf",
	}, nil
}

func TestBrowserFailureUsesTypedDetails(t *testing.T) {
	st := status.Convert(
		browserError(
			browser.Fail(
				workerproto.FailureReason_FAILURE_REASON_AUTHENTICATION_REQUIRED,
				"login: required",
			),
		),
	)
	if st.Code() != codes.FailedPrecondition || len(st.Details()) != 1 {
		t.Fatalf("unstructured failure: %v", st)
	}
	failure, ok := st.Details()[0].(*workerproto.Failure)
	if !ok || failure.Reason != workerproto.FailureReason_FAILURE_REASON_AUTHENTICATION_REQUIRED ||
		failure.Message != "login: required" {
		t.Fatalf("failure lost its type: %v", st.Details())
	}
	if status.Code(
		browserError(browser.Fail(workerproto.FailureReason(999), "invalid")),
	) != codes.Internal {
		t.Fatal("unknown failure reason crossed the worker boundary")
	}
}

func TestGRPCContractsAndTransfer(t *testing.T) {
	ctx := t.Context()
	root := t.TempDir()
	path := filepath.Join(root, "download")
	if err := os.WriteFile(path, []byte("file contents"), 0o600); err != nil {
		t.Fatal(err)
	}
	source := &fakeSource{path: path}
	worker, err := newSource(source, NewScheduler(ctx, 2), "https://slink.secioss.com")
	if err != nil {
		t.Fatal(err)
	}
	listener := bufconn.Listen(1 << 20)
	server := grpc.NewServer()
	workerproto.RegisterBrowserWorkerServer(server, worker)
	go func() { _ = server.Serve(listener) }()
	defer server.Stop()
	conn, err := grpc.NewClient(
		"passthrough:///bufconn",
		grpc.WithTransportCredentials(insecure.NewCredentials()),
		grpc.WithContextDialer(
			func(context.Context, string) (net.Conn, error) { return listener.Dial() },
		),
	)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = conn.Close() }()
	client := workerproto.NewBrowserWorkerClient(conn)
	listing, err := client.Courses(ctx, &emptypb.Empty{})
	if err != nil || listing.AcademicYear != 2026 || len(listing.Courses) != 1 {
		t.Fatalf("course listing: %v %v", listing, err)
	}
	snapshot, err := client.Materials(
		ctx,
		&workerproto.MaterialsRequest{CourseId: &workerproto.CourseId{Value: "KOG1"}},
	)
	if err != nil || snapshot.GetResourceList() == nil {
		t.Fatalf("empty fetched resource list lost: %v %v", snapshot, err)
	}
	stream, err := client.Download(
		ctx,
		&workerproto.DownloadRequest{
			MaterialId: &workerproto.MaterialId{Value: "SRY1"},
			ResourceId: &workerproto.ResourceId{Value: "SRS1"},
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	header, err := stream.Recv()
	if err != nil || header.GetHeader().GetFile().GetFilename() != "handout.pdf" {
		t.Fatalf("download header: %v %v", header, err)
	}
	chunk, err := stream.Recv()
	if err != nil || string(chunk.GetChunk()) != "file contents" {
		t.Fatalf("download data: %v %v", chunk, err)
	}
	if _, err := stream.Recv(); !errors.Is(err, io.EOF) {
		t.Fatalf("expected end of download, got %v", err)
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("worker retained downloaded file: %v", err)
	}
	source.fail = browser.Fail(
		workerproto.FailureReason_FAILURE_REASON_RESOURCE_NOT_FOUND,
		"missing",
	)
	failureStream, err := client.Download(
		ctx,
		&workerproto.DownloadRequest{
			MaterialId: &workerproto.MaterialId{Value: "SRY1"},
			ResourceId: &workerproto.ResourceId{Value: "SRS1"},
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	failurePart, err := failureStream.Recv()
	if err != nil || failurePart.GetHeader().GetSnapshot() == nil ||
		failurePart.GetHeader().
			GetFailure().
			GetReason() !=
			workerproto.FailureReason_FAILURE_REASON_RESOURCE_NOT_FOUND {
		t.Fatalf("partial download failure lost its snapshot or reason: %v %v", failurePart, err)
	}
	if _, err := client.SetSSOCookies(
		ctx,
		&workerproto.SSOCookies{
			Cookies: []*workerproto.Cookie{{Name: "bad", Domain: "evil.example"}},
		},
	); status.Code(err) != codes.InvalidArgument {
		t.Fatalf("unscoped cookie accepted: %v", err)
	}
	if _, err := client.SetSSOCookies(
		ctx,
		&workerproto.SSOCookies{
			Cookies: []*workerproto.Cookie{
				{
					Name:     "sso",
					Domain:   "slink.secioss.com",
					SameSite: workerproto.CookieSameSite(999),
				},
			},
		},
	); status.Code(err) != codes.InvalidArgument {
		t.Fatalf("unrecognized cookie enum accepted: %v", err)
	}
	if _, err := client.Materials(
		ctx,
		&workerproto.MaterialsRequest{},
	); status.Code(err) != codes.InvalidArgument {
		t.Fatalf("missing course ID accepted: %v", err)
	}
	expires := timestamppb.New(time.Date(2026, 11, 1, 0, 0, 0, 0, time.UTC))
	_, err = client.SetSSOCookies(
		ctx,
		&workerproto.SSOCookies{
			Cookies: []*workerproto.Cookie{
				{
					Name:         "sso",
					Domain:       "slink.secioss.com",
					SameSite:     workerproto.CookieSameSite_COOKIE_SAME_SITE_LAX,
					Priority:     workerproto.CookiePriority_COOKIE_PRIORITY_HIGH,
					SourceScheme: workerproto.CookieSourceScheme_COOKIE_SOURCE_SCHEME_SECURE,
					Expires:      expires,
				},
			},
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	cookies, err := worker.SSOCookies(ctx)
	if err != nil || len(cookies) != 1 || cookies[0].SameSite != "Lax" ||
		cookies[0].Priority != "High" ||
		cookies[0].Expires == nil ||
		!cookies[0].Expires.Time().Equal(expires.AsTime()) {
		t.Fatalf("cookie metadata changed: %v %v", cookies, err)
	}
}
