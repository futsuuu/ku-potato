package browserworker

import (
	"context"
	"errors"
	"io"
	"net/url"
	"os"
	"regexp"
	"strings"
	"sync"

	"github.com/chromedp/cdproto/cdp"
	"github.com/chromedp/cdproto/network"
	chromedp "github.com/futsuuu/ku-potato/browser-worker/browser"
	workerproto "github.com/futsuuu/ku-potato/browser-worker/protocol"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/emptypb"
)

var (
	materialID = regexp.MustCompile(`^[A-Z]+\d+$`)
	resourceID = regexp.MustCompile(`^SRS\d+$`)
)

type source interface {
	Courses(context.Context) (*workerproto.CourseListing, error)
	Materials(context.Context, string) (*workerproto.Snapshot, error)
	Resources(context.Context, string, string) (*workerproto.Snapshot, error)
	Download(context.Context, string, string, string) (chromedp.DownloadResult, error)
}

type Server struct {
	workerproto.UnimplementedBrowserWorkerServer
	browser   source
	scheduler *Scheduler
	mu        sync.Mutex
	cookies   []*network.CookieParam
	ssoHost   string
}

func NewServer(browser *chromedp.Browser, queue *Scheduler, ssoURL string) (*Server, error) {
	s, err := newSource(browser, queue, ssoURL)
	if err == nil {
		browser.UseCookieSource(s)
	}
	return s, err
}

func newSource(browser source, queue *Scheduler, ssoURL string) (*Server, error) {
	u, err := url.Parse(ssoURL)
	if err != nil || u.Hostname() == "" {
		return nil, errors.New("invalid SSO URL")
	}
	return &Server{browser: browser, scheduler: queue, ssoHost: u.Hostname()}, nil
}

func (s *Server) SSOCookies(context.Context) ([]*network.CookieParam, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]*network.CookieParam(nil), s.cookies...), nil
}

func (s *Server) RenewSSOCookies(ctx context.Context) ([]*network.CookieParam, error) {
	return s.SSOCookies(ctx)
}

func (s *Server) SetSSOCookies(
	ctx context.Context,
	request *workerproto.SSOCookies,
) (*emptypb.Empty, error) {
	params := make([]*network.CookieParam, 0, len(request.GetCookies()))
	for _, cookie := range request.GetCookies() {
		host := strings.TrimPrefix(cookie.GetDomain(), ".")
		if host == "" || (host != s.ssoHost && !strings.HasSuffix(s.ssoHost, "."+host)) ||
			cookie.GetName() == "" {
			return nil, status.Error(codes.InvalidArgument, "invalid SSO cookie")
		}
		param := &network.CookieParam{
			Name:       cookie.GetName(),
			Value:      cookie.GetValue(),
			Domain:     cookie.GetDomain(),
			Path:       cookie.GetPath(),
			Secure:     cookie.GetSecure(),
			HTTPOnly:   cookie.GetHttpOnly(),
			SourcePort: cookie.GetSourcePort(),
		}
		switch cookie.GetSameSite() {
		case workerproto.CookieSameSite_COOKIE_SAME_SITE_UNSPECIFIED:
		case workerproto.CookieSameSite_COOKIE_SAME_SITE_STRICT:
			param.SameSite = network.CookieSameSiteStrict
		case workerproto.CookieSameSite_COOKIE_SAME_SITE_LAX:
			param.SameSite = network.CookieSameSiteLax
		case workerproto.CookieSameSite_COOKIE_SAME_SITE_NONE:
			param.SameSite = network.CookieSameSiteNone
		default:
			return nil, status.Error(codes.InvalidArgument, "invalid SSO cookie")
		}
		switch cookie.GetPriority() {
		case workerproto.CookiePriority_COOKIE_PRIORITY_UNSPECIFIED:
		case workerproto.CookiePriority_COOKIE_PRIORITY_LOW:
			param.Priority = network.CookiePriorityLow
		case workerproto.CookiePriority_COOKIE_PRIORITY_MEDIUM:
			param.Priority = network.CookiePriorityMedium
		case workerproto.CookiePriority_COOKIE_PRIORITY_HIGH:
			param.Priority = network.CookiePriorityHigh
		default:
			return nil, status.Error(codes.InvalidArgument, "invalid SSO cookie")
		}
		switch cookie.GetSourceScheme() {
		case workerproto.CookieSourceScheme_COOKIE_SOURCE_SCHEME_UNSPECIFIED:
		case workerproto.CookieSourceScheme_COOKIE_SOURCE_SCHEME_UNSET:
			param.SourceScheme = network.CookieSourceSchemeUnset
		case workerproto.CookieSourceScheme_COOKIE_SOURCE_SCHEME_NON_SECURE:
			param.SourceScheme = network.CookieSourceSchemeNonSecure
		case workerproto.CookieSourceScheme_COOKIE_SOURCE_SCHEME_SECURE:
			param.SourceScheme = network.CookieSourceSchemeSecure
		default:
			return nil, status.Error(codes.InvalidArgument, "invalid SSO cookie")
		}
		if key := cookie.GetPartitionKey(); key != nil {
			param.PartitionKey = &network.CookiePartitionKey{
				TopLevelSite:         key.GetTopLevelSite(),
				HasCrossSiteAncestor: key.GetHasCrossSiteAncestor(),
			}
		}
		if expires := cookie.GetExpires(); expires != nil {
			if expires.CheckValid() != nil {
				return nil, status.Error(codes.InvalidArgument, "invalid SSO cookie expiration")
			}
			expiry := cdp.TimeSinceEpoch(expires.AsTime())
			param.Expires = &expiry
		}
		params = append(params, param)
	}
	s.mu.Lock()
	s.cookies = params
	s.mu.Unlock()
	return &emptypb.Empty{}, nil
}

func browserError(err error) error {
	if err == nil {
		return nil
	}
	if errors.Is(err, context.Canceled) {
		return status.Error(codes.Canceled, "operation canceled")
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return status.Error(codes.DeadlineExceeded, "operation timed out")
	}
	if failure, ok := errors.AsType[*chromedp.Failure](err); ok {
		if failure.Reason == workerproto.FailureReason_FAILURE_REASON_UNSPECIFIED ||
			workerproto.FailureReason_name[int32(failure.Reason)] == "" {
			return status.Error(codes.Internal, "unrecognized browser failure")
		}
		withDetails, detailErr := status.New(codes.FailedPrecondition, failure.Message).
			WithDetails(&workerproto.Failure{Reason: failure.Reason, Message: failure.Message})
		if detailErr != nil {
			return status.Error(codes.Internal, "browser failure encoding failed")
		}
		return withDetails.Err()
	}
	return status.Error(codes.Internal, "browser operation failed")
}

func requestCourseID(value *workerproto.CourseId, optional bool) (string, error) {
	if value == nil && optional {
		return "", nil
	}
	if value == nil || value.GetValue() == "" || len(value.GetValue()) > 200 {
		return "", status.Error(codes.InvalidArgument, "invalid course ID")
	}
	return value.GetValue(), nil
}

func materialIDValue(value *workerproto.MaterialId) (string, error) {
	if value == nil || !materialID.MatchString(value.GetValue()) {
		return "", status.Error(codes.InvalidArgument, "invalid material ID")
	}
	return value.GetValue(), nil
}

func resourceIDValue(value *workerproto.ResourceId) (string, error) {
	if value == nil || !resourceID.MatchString(value.GetValue()) {
		return "", status.Error(codes.InvalidArgument, "invalid resource ID")
	}
	return value.GetValue(), nil
}

func (s *Server) Courses(
	ctx context.Context,
	_ *emptypb.Empty,
) (*workerproto.CourseListing, error) {
	result, err := s.scheduler.Run(
		ctx,
		"courses",
		func(ctx context.Context) (any, error) { return s.browser.Courses(ctx) },
	)
	if err != nil {
		return nil, browserError(err)
	}
	listing, ok := result.(*workerproto.CourseListing)
	if !ok || listing == nil {
		return nil, status.Error(codes.Internal, "invalid browser listing")
	}
	return listing, nil
}

func (s *Server) Materials(
	ctx context.Context,
	req *workerproto.MaterialsRequest,
) (*workerproto.Snapshot, error) {
	id, err := requestCourseID(req.GetCourseId(), false)
	if err != nil {
		return nil, err
	}
	result, err := s.scheduler.Run(
		ctx,
		"materials:"+id,
		func(ctx context.Context) (any, error) { return s.browser.Materials(ctx, id) },
	)
	if err != nil {
		return nil, browserError(err)
	}
	snapshot, ok := result.(*workerproto.Snapshot)
	if !ok || snapshot == nil {
		return nil, status.Error(codes.Internal, "invalid browser snapshot")
	}
	return snapshot, nil
}

func (s *Server) Resources(
	ctx context.Context,
	req *workerproto.ResourcesRequest,
) (*workerproto.Snapshot, error) {
	material, err := materialIDValue(req.GetMaterialId())
	if err != nil {
		return nil, err
	}
	preferred, err := requestCourseID(req.GetPreferredCourseId(), true)
	if err != nil {
		return nil, err
	}
	result, err := s.scheduler.Run(
		ctx,
		"resources:"+material+":"+preferred,
		func(ctx context.Context) (any, error) {
			return s.browser.Resources(ctx, material, preferred)
		},
	)
	if err != nil {
		return nil, browserError(err)
	}
	snapshot, ok := result.(*workerproto.Snapshot)
	if !ok || snapshot == nil {
		return nil, status.Error(codes.Internal, "invalid browser snapshot")
	}
	return snapshot, nil
}

func (s *Server) Download(
	req *workerproto.DownloadRequest,
	stream workerproto.BrowserWorker_DownloadServer,
) error {
	material, err := materialIDValue(req.GetMaterialId())
	if err != nil {
		return err
	}
	resource, err := resourceIDValue(req.GetResourceId())
	if err != nil {
		return err
	}
	preferred, err := requestCourseID(req.GetPreferredCourseId(), true)
	if err != nil {
		return err
	}
	value, err := s.scheduler.Run(stream.Context(), "", func(ctx context.Context) (any, error) {
		return s.browser.Download(ctx, material, resource, preferred)
	})
	if value == nil {
		return browserError(err)
	}
	result := value.(chromedp.DownloadResult)
	if result.Path != "" {
		defer func() { _ = os.Remove(result.Path) }()
	}
	if result.Snapshot == nil {
		result.Snapshot = &workerproto.Snapshot{}
	}
	header := &workerproto.DownloadHeader{Snapshot: result.Snapshot}
	if err == nil && result.Path == "" && result.URL == "" {
		err = chromedp.Fail(workerproto.FailureReason_FAILURE_REASON_SOURCE, "資料が取得できませんでした。")
	}
	if err != nil {
		var failure *chromedp.Failure
		if !errors.As(err, &failure) ||
			failure.Reason == workerproto.FailureReason_FAILURE_REASON_UNSPECIFIED ||
			workerproto.FailureReason_name[int32(failure.Reason)] == "" {
			return browserError(err)
		}
		header.Outcome = &workerproto.DownloadHeader_Failure{
			Failure: &workerproto.Failure{Reason: failure.Reason, Message: failure.Message},
		}
	} else if result.URL != "" && result.Path == "" {
		header.Outcome = &workerproto.DownloadHeader_ExternalUrl{ExternalUrl: result.URL}
	} else if result.Path != "" && result.URL == "" && result.Filename != "" {
		info, statErr := os.Stat(result.Path)
		if statErr != nil {
			return browserError(statErr)
		}
		header.Outcome = &workerproto.DownloadHeader_File{
			File: &workerproto.FileDownload{Filename: result.Filename, ByteSize: info.Size()},
		}
	} else {
		return status.Error(codes.Internal, "invalid browser download")
	}
	if err := stream.Send(
		&workerproto.DownloadPart{Part: &workerproto.DownloadPart_Header{Header: header}},
	); err != nil {
		return err
	}
	if header.GetFile() == nil {
		return nil
	}
	file, err := os.Open(result.Path)
	if err != nil {
		return browserError(err)
	}
	defer func() { _ = file.Close() }()
	buffer := make([]byte, 64<<10)
	for {
		size, err := file.Read(buffer)
		if size > 0 {
			if sendErr := stream.Send(
				&workerproto.DownloadPart{
					Part: &workerproto.DownloadPart_Chunk{Chunk: buffer[:size]},
				},
			); sendErr != nil {
				return sendErr
			}
		}
		if err == io.EOF {
			return nil
		}
		if err != nil {
			return browserError(err)
		}
	}
}
