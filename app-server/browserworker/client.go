package browserworker

import (
	"context"
	"errors"
	"io"
	"os"
	"sync"

	"github.com/chromedp/cdproto/network"
	"github.com/futsuuu/ku-potato/app-server/application/outport"
	chromedp "github.com/futsuuu/ku-potato/app-server/browserauth"
	"github.com/futsuuu/ku-potato/app-server/domain"
	workerproto "github.com/futsuuu/ku-potato/browser-worker/protocol"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/emptypb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type Client struct {
	worker    workerproto.BrowserWorkerClient
	auth      *chromedp.LMSAuthenticator
	directory string
	mu        sync.Mutex
}

var _ outport.ContentSource = (*Client)(nil)

func New(worker workerproto.BrowserWorkerClient, auth *chromedp.LMSAuthenticator, directory string) *Client {
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
func encodeCookie(cookie *network.CookieParam) (*workerproto.Cookie, error) {
	part := &workerproto.Cookie{Name: cookie.Name, Value: cookie.Value, Domain: cookie.Domain, Path: cookie.Path, Secure: cookie.Secure, HttpOnly: cookie.HTTPOnly, SourcePort: cookie.SourcePort}
	switch cookie.SameSite {
	case "":
		part.SameSite = workerproto.CookieSameSite_COOKIE_SAME_SITE_UNSPECIFIED
	case network.CookieSameSiteStrict:
		part.SameSite = workerproto.CookieSameSite_COOKIE_SAME_SITE_STRICT
	case network.CookieSameSiteLax:
		part.SameSite = workerproto.CookieSameSite_COOKIE_SAME_SITE_LAX
	case network.CookieSameSiteNone:
		part.SameSite = workerproto.CookieSameSite_COOKIE_SAME_SITE_NONE
	default:
		return nil, domain.Fail("source", "認証Cookieが不正です。")
	}
	switch cookie.Priority {
	case "":
		part.Priority = workerproto.CookiePriority_COOKIE_PRIORITY_UNSPECIFIED
	case network.CookiePriorityLow:
		part.Priority = workerproto.CookiePriority_COOKIE_PRIORITY_LOW
	case network.CookiePriorityMedium:
		part.Priority = workerproto.CookiePriority_COOKIE_PRIORITY_MEDIUM
	case network.CookiePriorityHigh:
		part.Priority = workerproto.CookiePriority_COOKIE_PRIORITY_HIGH
	default:
		return nil, domain.Fail("source", "認証Cookieが不正です。")
	}
	switch cookie.SourceScheme {
	case "":
		part.SourceScheme = workerproto.CookieSourceScheme_COOKIE_SOURCE_SCHEME_UNSPECIFIED
	case network.CookieSourceSchemeUnset:
		part.SourceScheme = workerproto.CookieSourceScheme_COOKIE_SOURCE_SCHEME_UNSET
	case network.CookieSourceSchemeNonSecure:
		part.SourceScheme = workerproto.CookieSourceScheme_COOKIE_SOURCE_SCHEME_NON_SECURE
	case network.CookieSourceSchemeSecure:
		part.SourceScheme = workerproto.CookieSourceScheme_COOKIE_SOURCE_SCHEME_SECURE
	default:
		return nil, domain.Fail("source", "認証Cookieが不正です。")
	}
	if cookie.PartitionKey != nil {
		part.PartitionKey = &workerproto.PartitionKey{TopLevelSite: cookie.PartitionKey.TopLevelSite, HasCrossSiteAncestor: cookie.PartitionKey.HasCrossSiteAncestor}
	}
	if cookie.Expires != nil {
		part.Expires = timestamppb.New(cookie.Expires.Time())
	}
	return part, nil
}
func (c *Client) refresh(ctx context.Context, renew bool) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	var cookies []*network.CookieParam
	var err error
	if renew {
		cookies, err = c.auth.RenewSSOCookies(ctx)
	} else {
		cookies, err = c.auth.SSOCookies(ctx)
	}
	if err != nil {
		return err
	}
	request := &workerproto.SSOCookies{}
	for _, cookie := range cookies {
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
func withSession[T any](ctx context.Context, c *Client, run func(context.Context) (T, error)) (T, error) {
	for attempt := 0; attempt < 3; attempt++ {
		value, err := run(ctx)
		var failure *domain.Error
		if !errors.As(err, &failure) || failure.Reason != "authentication-required" || attempt == 2 || ctx.Err() != nil {
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
		value, err := c.worker.Materials(ctx, &workerproto.MaterialsRequest{CourseId: &workerproto.CourseId{Value: id}})
		if err != nil {
			return domain.Snapshot{}, translate(err)
		}
		return decodeSnapshot(value)
	})
}
func (c *Client) Resources(ctx context.Context, material, preferred string) (domain.Snapshot, error) {
	return withSession(ctx, c, func(ctx context.Context) (domain.Snapshot, error) {
		request := &workerproto.ResourcesRequest{MaterialId: &workerproto.MaterialId{Value: material}}
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
func (c *Client) Download(ctx context.Context, material, resource, preferred string) (outport.Download, error) {
	return withSession(ctx, c, func(ctx context.Context) (outport.Download, error) {
		request := &workerproto.DownloadRequest{MaterialId: &workerproto.MaterialId{Value: material}, ResourceId: &workerproto.ResourceId{Value: resource}}
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
			file.Close()
			if !ok {
				os.Remove(file.Name())
			}
		}()
		var received int64
		for {
			part, receiveErr := stream.Recv()
			if receiveErr == io.EOF {
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
