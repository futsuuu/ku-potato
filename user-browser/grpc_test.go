package userbrowser

import (
	"context"
	"errors"
	"net"
	"strings"
	"testing"
	"time"

	"github.com/chromedp/cdproto/cdp"
	"github.com/chromedp/cdproto/network"
	chromedp "github.com/futsuuu/ku-potato/user-browser/browser"
	userproto "github.com/futsuuu/ku-potato/user-browser/protocol"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/status"
	"google.golang.org/grpc/test/bufconn"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/emptypb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type fakeAuth struct {
	interactive bool
	registered  bool
	renewed     bool
	err         error
	cookies     []*network.CookieParam
}

func (f *fakeAuth) Login(_ context.Context, interactive bool) error {
	f.interactive = interactive
	return f.err
}
func (f *fakeAuth) Status(context.Context) (bool, error) { return true, f.err }
func (f *fakeAuth) RegisterWebAuthn(_ context.Context, interactive bool) error {
	f.registered = true
	f.interactive = interactive
	return f.err
}

func (f *fakeAuth) WebAuthnRegistrationStatus(
	context.Context,
) (chromedp.RegistrationResult, error) {
	return chromedp.RegistrationResult{Registered: f.registered}, f.err
}
func (f *fakeAuth) DeleteWebAuthn(context.Context) error { f.registered = false; return f.err }
func (f *fakeAuth) SSOCookies(context.Context) ([]*network.CookieParam, error) {
	return f.cookies, f.err
}

func (f *fakeAuth) RenewSSOCookies(ctx context.Context) ([]*network.CookieParam, error) {
	f.renewed = true
	return f.SSOCookies(ctx)
}

func (f *fakeAuth) Cookies(ctx context.Context) ([]*network.CookieParam, error) {
	return f.SSOCookies(ctx)
}

func newTestClient(t *testing.T, lms, google *fakeAuth) userproto.UserBrowserClient {
	t.Helper()
	listener := bufconn.Listen(1 << 20)
	server := grpc.NewServer()
	userproto.RegisterUserBrowserServer(server, NewServer(lms, google))
	go func() { _ = server.Serve(listener) }()
	t.Cleanup(server.Stop)
	conn, err := grpc.NewClient(
		"passthrough:///user-browser",
		grpc.WithTransportCredentials(insecure.NewCredentials()),
		grpc.WithContextDialer(
			func(context.Context, string) (net.Conn, error) { return listener.Dial() },
		),
	)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = conn.Close() })
	return userproto.NewUserBrowserClient(conn)
}

func TestAuthenticationRPCs(t *testing.T) {
	lms, google := &fakeAuth{}, &fakeAuth{}
	client := newTestClient(t, lms, google)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	for _, provider := range []userproto.Provider{userproto.Provider_PROVIDER_LMS, userproto.Provider_PROVIDER_GOOGLE} {
		if _, err := client.Login(
			ctx,
			&userproto.LoginRequest{Provider: provider, Interactive: true},
		); err != nil {
			t.Fatal(err)
		}
		result, err := client.Status(ctx, &userproto.ProviderRequest{Provider: provider})
		if err != nil || !result.GetAuthenticated() {
			t.Fatal(result, err)
		}
	}
	for _, provider := range []userproto.Provider{userproto.Provider_PROVIDER_UNSPECIFIED, userproto.Provider(100)} {
		_, err := client.Login(ctx, &userproto.LoginRequest{Provider: provider})
		if status.Code(err) != codes.InvalidArgument {
			t.Fatal("unknown provider accepted", err)
		}
	}
	if _, err := client.RegisterWebAuthn(
		ctx,
		&userproto.InteractiveRequest{Interactive: true},
	); err != nil {
		t.Fatal(err)
	}
	result, err := client.WebAuthnRegistrationStatus(ctx, &emptypb.Empty{})
	if err != nil || !result.GetRegistered() {
		t.Fatal(result, err)
	}
	if _, err := client.DeleteWebAuthn(ctx, &emptypb.Empty{}); err != nil {
		t.Fatal(err)
	}
	result, err = client.WebAuthnRegistrationStatus(ctx, &emptypb.Empty{})
	if err != nil || result.GetRegistered() {
		t.Fatal(result, err)
	}
	if !lms.interactive || !google.interactive {
		t.Fatal("interactive flag lost")
	}
}

func TestCookieRPCsPreserveAttributesAndRenewal(t *testing.T) {
	expires := cdp.TimeSinceEpoch(time.Now().Add(time.Hour).Truncate(time.Second))
	cookie := &network.CookieParam{
		Name:         "sso",
		Value:        "secret",
		Domain:       ".example.org",
		Path:         "/sso",
		Secure:       true,
		HTTPOnly:     true,
		SameSite:     network.CookieSameSiteNone,
		Expires:      &expires,
		Priority:     network.CookiePriorityHigh,
		SourceScheme: network.CookieSourceSchemeSecure,
		SourcePort:   443,
		PartitionKey: &network.CookiePartitionKey{
			TopLevelSite:         "https://example.org",
			HasCrossSiteAncestor: true,
		},
	}
	lms, google := &fakeAuth{
		cookies: []*network.CookieParam{nil, cookie},
	}, &fakeAuth{
		cookies: []*network.CookieParam{cookie},
	}
	client := newTestClient(t, lms, google)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	result, err := client.SSOCookies(ctx, &userproto.SSOCookiesRequest{})
	if err != nil || lms.renewed || len(result.GetCookies()) != 1 {
		t.Fatal(result, err)
	}
	got := result.GetCookies()[0]
	want := &userproto.Cookie{
		Name:         "sso",
		Value:        "secret",
		Domain:       ".example.org",
		Path:         "/sso",
		Secure:       true,
		HttpOnly:     true,
		SameSite:     userproto.CookieSameSite_COOKIE_SAME_SITE_NONE,
		Expires:      timestamppb.New(expires.Time()),
		Priority:     userproto.CookiePriority_COOKIE_PRIORITY_HIGH,
		SourceScheme: userproto.CookieSourceScheme_COOKIE_SOURCE_SCHEME_SECURE,
		SourcePort:   443,
		PartitionKey: &userproto.PartitionKey{
			TopLevelSite:         "https://example.org",
			HasCrossSiteAncestor: true,
		},
	}
	if !proto.Equal(got, want) {
		t.Fatal("cookie attributes lost", got, want, err)
	}
	if _, err := client.SSOCookies(
		ctx,
		&userproto.SSOCookiesRequest{Renew: true},
	); err != nil ||
		!lms.renewed {
		t.Fatal(err)
	}
	result, err = client.GoogleCookies(ctx, &emptypb.Empty{})
	if err != nil || len(result.GetCookies()) != 1 {
		t.Fatal(result, err)
	}
}

func TestFailuresAreStructuredAndPrivateDiagnosticsAreRedacted(t *testing.T) {
	for _, reason := range []string{"authentication-required", "authentication-storage", "browser-start", "source", "conflict"} {
		err := browserError(chromedp.Fail(reason, "public message"))
		if status.Code(err) != codes.FailedPrecondition {
			t.Fatal(err)
		}
		details := status.Convert(err).Details()
		if len(details) != 1 {
			t.Fatal(details)
		}
		failure, ok := details[0].(*userproto.Failure)
		if !ok || failure.GetReason() == userproto.FailureReason_FAILURE_REASON_UNSPECIFIED ||
			failure.GetMessage() != "public message" {
			t.Fatal(details)
		}
	}
	for _, err := range []error{errors.New("privateKey=secret"), chromedp.Fail("unknown", "privateKey=secret")} {
		result := browserError(err)
		if status.Code(result) != codes.Internal || strings.Contains(result.Error(), "secret") {
			t.Fatal(result)
		}
	}
	if status.Code(browserError(context.Canceled)) != codes.Canceled ||
		status.Code(browserError(context.DeadlineExceeded)) != codes.DeadlineExceeded {
		t.Fatal("cancellation lost")
	}
	// Check that the same error details survive actual gRPC transport.
	client := newTestClient(
		t,
		&fakeAuth{err: chromedp.Fail("conflict", "already registered")},
		&fakeAuth{},
	)
	_, err := client.RegisterWebAuthn(context.Background(), &userproto.InteractiveRequest{})
	if status.Code(err) != codes.FailedPrecondition || len(status.Convert(err).Details()) != 1 {
		t.Fatal(err)
	}
}
