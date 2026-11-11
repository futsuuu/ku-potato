package userbrowser

import (
	"context"
	"errors"

	"github.com/chromedp/cdproto/network"
	chromedp "github.com/futsuuu/ku-potato/user-browser/browser"
	userproto "github.com/futsuuu/ku-potato/user-browser/protocol"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/emptypb"
)

type authentication interface {
	Login(context.Context, bool) error
	Status(context.Context) (bool, error)
}
type lmsAuthentication interface {
	authentication
	RegisterWebAuthn(context.Context, bool) error
	WebAuthnRegistrationStatus(context.Context) (chromedp.RegistrationResult, error)
	DeleteWebAuthn(context.Context) error
	SSOCookies(context.Context) ([]*network.CookieParam, error)
	RenewSSOCookies(context.Context) ([]*network.CookieParam, error)
}
type googleAuthentication interface {
	authentication
	Cookies(context.Context) ([]*network.CookieParam, error)
}

type Server struct {
	userproto.UnimplementedUserBrowserServer
	lms    lmsAuthentication
	google googleAuthentication
}

func NewServer(lms lmsAuthentication, google googleAuthentication) *Server {
	return &Server{lms: lms, google: google}
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
	if failure, ok := errors.AsType[*chromedp.Error](err); ok {
		reason := map[string]userproto.FailureReason{
			"authentication-required": userproto.FailureReason_FAILURE_REASON_AUTHENTICATION_REQUIRED,
			"authentication-storage":  userproto.FailureReason_FAILURE_REASON_AUTHENTICATION_STORAGE,
			"browser-start":           userproto.FailureReason_FAILURE_REASON_BROWSER_START,
			"source":                  userproto.FailureReason_FAILURE_REASON_SOURCE,
			"conflict":                userproto.FailureReason_FAILURE_REASON_CONFLICT,
		}[failure.Reason]
		if reason == userproto.FailureReason_FAILURE_REASON_UNSPECIFIED {
			return status.Error(codes.Internal, "unrecognized browser failure")
		}
		result, detailErr := status.New(codes.FailedPrecondition, failure.Message).
			WithDetails(&userproto.Failure{Reason: reason, Message: failure.Message})
		if detailErr != nil {
			return status.Error(codes.Internal, "browser failure encoding failed")
		}
		return result.Err()
	}
	// CDP and filesystem errors can contain credential material or private paths.
	return status.Error(codes.Internal, "user browser operation failed")
}

func (s *Server) provider(provider userproto.Provider) (authentication, error) {
	switch provider {
	case userproto.Provider_PROVIDER_LMS:
		return s.lms, nil
	case userproto.Provider_PROVIDER_GOOGLE:
		return s.google, nil
	case userproto.Provider_PROVIDER_UNSPECIFIED:
		return nil, status.Error(codes.InvalidArgument, "missing authentication provider")
	default:
		return nil, status.Error(codes.InvalidArgument, "invalid authentication provider")
	}
}

func (s *Server) Login(
	ctx context.Context,
	request *userproto.LoginRequest,
) (*emptypb.Empty, error) {
	auth, err := s.provider(request.GetProvider())
	if err != nil {
		return nil, err
	}
	return &emptypb.Empty{}, browserError(auth.Login(ctx, request.GetInteractive()))
}

func (s *Server) Status(
	ctx context.Context,
	request *userproto.ProviderRequest,
) (*userproto.AuthenticationStatus, error) {
	auth, err := s.provider(request.GetProvider())
	if err != nil {
		return nil, err
	}
	ok, err := auth.Status(ctx)
	return &userproto.AuthenticationStatus{Authenticated: ok}, browserError(err)
}

func (s *Server) RegisterWebAuthn(
	ctx context.Context,
	request *userproto.InteractiveRequest,
) (*emptypb.Empty, error) {
	return &emptypb.Empty{}, browserError(s.lms.RegisterWebAuthn(ctx, request.GetInteractive()))
}

func (s *Server) WebAuthnRegistrationStatus(
	ctx context.Context,
	_ *emptypb.Empty,
) (*userproto.RegistrationStatus, error) {
	result, err := s.lms.WebAuthnRegistrationStatus(ctx)
	return &userproto.RegistrationStatus{Registered: result.Registered}, browserError(err)
}

func (s *Server) DeleteWebAuthn(ctx context.Context, _ *emptypb.Empty) (*emptypb.Empty, error) {
	return &emptypb.Empty{}, browserError(s.lms.DeleteWebAuthn(ctx))
}

func (s *Server) SSOCookies(
	ctx context.Context,
	request *userproto.SSOCookiesRequest,
) (*userproto.Cookies, error) {
	var cookies []*network.CookieParam
	var err error
	if request.GetRenew() {
		cookies, err = s.lms.RenewSSOCookies(ctx)
	} else {
		cookies, err = s.lms.SSOCookies(ctx)
	}
	if err != nil {
		return nil, browserError(err)
	}
	return encodeCookies(cookies)
}

func (s *Server) GoogleCookies(ctx context.Context, _ *emptypb.Empty) (*userproto.Cookies, error) {
	cookies, err := s.google.Cookies(ctx)
	if err != nil {
		return nil, browserError(err)
	}
	return encodeCookies(cookies)
}
