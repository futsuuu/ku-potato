package browserworker

import (
	"context"
	"errors"
	"io"
	"os"
	"sync"

	"github.com/futsuuu/ku-potato/app-server/application/outport"
	"github.com/futsuuu/ku-potato/app-server/domain"
	workerproto "github.com/futsuuu/ku-potato/browser-worker/protocol"
	userproto "github.com/futsuuu/ku-potato/user-browser/protocol"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/emptypb"
)

type CookieSource interface {
	SSOCookies(context.Context, bool) (*userproto.Cookies, error)
}

type Client struct {
	worker    workerproto.BrowserWorkerClient
	auth      CookieSource
	directory string
	mu        sync.Mutex
}

var _ outport.ContentSource = (*Client)(nil)

func New(
	worker workerproto.BrowserWorkerClient,
	auth CookieSource,
	directory string,
) *Client {
	return &Client{worker: worker, auth: auth, directory: directory}
}

func translate(err error) error {
	if err == nil {
		return nil
	}
	code := status.Code(err)
	if code == codes.FailedPrecondition {
		for _, detail := range status.Convert(err).Details() {
			if failure, ok := detail.(*workerproto.Failure); ok {
				return decodeFailure(failure)
			}
		}
	}
	if code == codes.DeadlineExceeded {
		return context.DeadlineExceeded
	}
	if code == codes.Canceled {
		return context.Canceled
	}
	return domain.Fail("source", "ブラウザワーカーに接続できません。")
}

func encodeCookie(cookie *userproto.Cookie) (*workerproto.Cookie, error) {
	// These are separate wire contracts; reject unknown values rather than
	// silently dropping attributes when forwarding the session.
	if _, ok := userproto.CookieSameSite_name[int32(cookie.GetSameSite())]; !ok {
		return nil, domain.Fail("source", "認証Cookieが不正です。")
	}
	if _, ok := userproto.CookiePriority_name[int32(cookie.GetPriority())]; !ok {
		return nil, domain.Fail("source", "認証Cookieが不正です。")
	}
	if _, ok := userproto.CookieSourceScheme_name[int32(cookie.GetSourceScheme())]; !ok {
		return nil, domain.Fail("source", "認証Cookieが不正です。")
	}
	if expires := cookie.GetExpires(); expires != nil && expires.CheckValid() != nil {
		return nil, domain.Fail("source", "認証Cookieが不正です。")
	}
	part := &workerproto.Cookie{
		Name:         cookie.GetName(),
		Value:        cookie.GetValue(),
		Domain:       cookie.GetDomain(),
		Path:         cookie.GetPath(),
		Secure:       cookie.GetSecure(),
		HttpOnly:     cookie.GetHttpOnly(),
		Expires:      cookie.GetExpires(),
		SameSite:     workerproto.CookieSameSite(cookie.GetSameSite()),
		Priority:     workerproto.CookiePriority(cookie.GetPriority()),
		SourceScheme: workerproto.CookieSourceScheme(cookie.GetSourceScheme()),
		SourcePort:   cookie.GetSourcePort(),
	}
	if key := cookie.GetPartitionKey(); key != nil {
		part.PartitionKey = &workerproto.PartitionKey{
			TopLevelSite:         key.GetTopLevelSite(),
			HasCrossSiteAncestor: key.GetHasCrossSiteAncestor(),
		}
	}
	return part, nil
}

func (c *Client) refresh(ctx context.Context, renew bool) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	cookies, err := c.auth.SSOCookies(ctx, renew)
	if err != nil {
		return err
	}
	request := &workerproto.SSOCookies{}
	for _, cookie := range cookies.GetCookies() {
		if cookie == nil {
			continue
		}
		part, err := encodeCookie(cookie)
		if err != nil {
			return err
		}
		request.Cookies = append(request.Cookies, part)
	}
	_, err = c.worker.SetSSOCookies(ctx, request)
	return translate(err)
}

func withSession[T any](
	ctx context.Context,
	c *Client,
	run func(context.Context) (T, error),
) (T, error) {
	for attempt := range 3 {
		value, err := run(ctx)
		var failure *domain.Error
		if !errors.As(err, &failure) || failure.Reason != "authentication-required" ||
			attempt == 2 ||
			ctx.Err() != nil {
			return value, err
		}
		if err = c.refresh(ctx, attempt == 1); err != nil {
			return value, err
		}
	}
	var zero T
	return zero, context.DeadlineExceeded
}

func (c *Client) Courses(ctx context.Context) (domain.CourseListing, error) {
	return withSession(ctx, c, func(ctx context.Context) (domain.CourseListing, error) {
		value, err := c.worker.Courses(ctx, &emptypb.Empty{})
		if err != nil {
			return domain.CourseListing{}, translate(err)
		}
		return decodeListing(value)
	})
}

func (c *Client) Materials(ctx context.Context, id string) (domain.Snapshot, error) {
	return withSession(ctx, c, func(ctx context.Context) (domain.Snapshot, error) {
		value, err := c.worker.Materials(
			ctx,
			&workerproto.MaterialsRequest{CourseId: &workerproto.CourseId{Value: id}},
		)
		if err != nil {
			return domain.Snapshot{}, translate(err)
		}
		return decodeSnapshot(value)
	})
}

func (c *Client) Resources(
	ctx context.Context,
	material, preferred string,
) (domain.Snapshot, error) {
	return withSession(ctx, c, func(ctx context.Context) (domain.Snapshot, error) {
		request := &workerproto.ResourcesRequest{
			MaterialId: &workerproto.MaterialId{Value: material},
		}
		if preferred != "" {
			request.PreferredCourseId = &workerproto.CourseId{Value: preferred}
		}
		value, err := c.worker.Resources(ctx, request)
		if err != nil {
			return domain.Snapshot{}, translate(err)
		}
		return decodeSnapshot(value)
	})
}

func (c *Client) Download(
	ctx context.Context,
	material, resource, preferred string,
) (outport.Download, error) {
	return withSession(ctx, c, func(ctx context.Context) (outport.Download, error) {
		request := &workerproto.DownloadRequest{
			MaterialId: &workerproto.MaterialId{Value: material},
			ResourceId: &workerproto.ResourceId{Value: resource},
		}
		if preferred != "" {
			request.PreferredCourseId = &workerproto.CourseId{Value: preferred}
		}
		stream, err := c.worker.Download(ctx, request)
		if err != nil {
			return outport.Download{}, translate(err)
		}
		first, err := stream.Recv()
		if err != nil {
			return outport.Download{}, translate(err)
		}
		header := first.GetHeader()
		if header == nil || header.Snapshot == nil {
			return outport.Download{}, domain.Fail("source", "ブラウザワーカーから不正な応答を受け取りました。")
		}
		snapshot, err := decodeSnapshot(header.GetSnapshot())
		if err != nil {
			return outport.Download{}, err
		}
		result := outport.Download{Snapshot: snapshot}
		switch outcome := header.GetOutcome().(type) {
		case *workerproto.DownloadHeader_Failure:
			return result, decodeFailure(outcome.Failure)
		case *workerproto.DownloadHeader_ExternalUrl:
			url, err := externalURL(outcome.ExternalUrl)
			if err != nil {
				return result, err
			}
			result.URL = url
			return result, nil
		case *workerproto.DownloadHeader_File:
			if outcome.File == nil || outcome.File.Filename == "" || outcome.File.ByteSize < 0 {
				return result, domain.Fail("source", "資料の応答が不正です。")
			}
			result.Filename = outcome.File.Filename
		default:
			return result, domain.Fail("source", "資料の応答が不正です。")
		}
		file, err := os.CreateTemp(c.directory, "browser-resource-*")
		if err != nil {
			return result, err
		}
		ok := false
		defer func() {
			_ = file.Close()
			if !ok {
				_ = os.Remove(file.Name())
			}
		}()
		var received int64
		for {
			part, receiveErr := stream.Recv()
			if errors.Is(receiveErr, io.EOF) {
				break
			}
			if receiveErr != nil {
				return result, translate(receiveErr)
			}
			if _, ok := part.GetPart().(*workerproto.DownloadPart_Chunk); !ok {
				return result, domain.Fail("source", "資料の応答が不正です。")
			}
			if _, err = file.Write(part.GetChunk()); err != nil {
				return result, err
			}
			received += int64(len(part.GetChunk()))
			if received > header.GetFile().GetByteSize() {
				return result, domain.Fail("source", "資料のサイズが一致しません。")
			}
		}
		if received != header.GetFile().GetByteSize() {
			return result, domain.Fail("source", "資料のサイズが一致しません。")
		}
		if err = file.Close(); err != nil {
			return result, err
		}
		result.Path = file.Name()
		ok = true
		return result, nil
	})
}
