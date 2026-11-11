package userbrowser

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"reflect"
	"slices"
	"testing"
	"time"

	"github.com/futsuuu/ku-potato/app-server/domain"
	userproto "github.com/futsuuu/ku-potato/user-browser/protocol"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func TestTranslateFailuresAndCancellation(t *testing.T) {
	for reason, expected := range map[userproto.FailureReason]string{
		userproto.FailureReason_FAILURE_REASON_AUTHENTICATION_REQUIRED: "authentication-required",
		userproto.FailureReason_FAILURE_REASON_AUTHENTICATION_STORAGE:  "authentication-storage",
		userproto.FailureReason_FAILURE_REASON_BROWSER_START:           "browser-start",
		userproto.FailureReason_FAILURE_REASON_SOURCE:                  "source",
		userproto.FailureReason_FAILURE_REASON_CONFLICT:                "conflict",
	} {
		st, err := status.New(codes.FailedPrecondition, "public").
			WithDetails(&userproto.Failure{Reason: reason, Message: "public"})
		if err != nil {
			t.Fatal(err)
		}
		var got *domain.Error
		if !errors.As(translate(st.Err()), &got) || got.Reason != expected ||
			got.Message != "public" {
			t.Fatal(got)
		}
	}
	for _, err := range []error{status.Error(codes.Internal, "secret"), status.Error(codes.Unavailable, "secret")} {
		var got *domain.Error
		if !errors.As(translate(err), &got) || got.Reason != "source" || got.Message == "secret" {
			t.Fatal(got)
		}
	}
	if !errors.Is(translate(status.Error(codes.Canceled, "")), context.Canceled) ||
		!errors.Is(translate(status.Error(codes.DeadlineExceeded, "")), context.DeadlineExceeded) {
		t.Fatal("cancellation lost")
	}
}

func TestGoogleCookieJarPreservesScope(t *testing.T) {
	cookies := []*userproto.Cookie{
		{Name: "shared", Value: "v", Domain: ".google.com", Path: "/", Secure: true},
		{
			Name:     "host",
			Value:    "v",
			Domain:   "drive.google.com",
			Path:     "/",
			Secure:   true,
			HttpOnly: true,
		},
		{Name: "path", Value: "v", Domain: "drive.google.com", Path: "/download", Secure: true},
		{
			Name:   "usercontent",
			Value:  "v",
			Domain: "drive.usercontent.google.com",
			Path:   "/",
			Secure: true,
		},
		{
			Name:    "expired",
			Value:   "v",
			Domain:  ".google.com",
			Path:    "/",
			Expires: timestamppb.New(time.Now().Add(-time.Hour)),
		},
		{
			Name:         "partitioned",
			Value:        "v",
			Domain:       ".google.com",
			Path:         "/",
			PartitionKey: &userproto.PartitionKey{},
		},
		{Name: "sso", Value: "v", Domain: "slink.secioss.com", Path: "/"},
		{Name: "untrusted", Value: "v", Domain: "google.com.evil.test", Path: "/"},
	}
	jar, err := googleCookieJar(cookies)
	if err != nil {
		t.Fatal(err)
	}
	for address, expected := range map[string][]string{
		"https://drive.google.com/":              {"host", "shared"},
		"https://drive.google.com/download/file": {"host", "path", "shared"},
		"https://sub.drive.google.com/":          {"shared"},
		"https://drive.usercontent.google.com/":  {"shared", "usercontent"},
		"http://drive.google.com/":               {},
		"https://slink.secioss.com/":             {},
		"https://google.com.evil.test/":          {},
	} {
		names := []string{}
		parsed, _ := url.Parse(address)
		for _, cookie := range jar.Cookies(parsed) {
			names = append(names, cookie.Name)
		}
		slices.Sort(names)
		if !reflect.DeepEqual(names, expected) {
			t.Fatal(address, names, expected)
		}
	}
	if _, err := googleCookieJar(nil); err == nil {
		t.Fatal("empty session accepted")
	}
}

// Ensure the interface used by Drive remains available through the remote adapter.
var _ interface {
	CookieJar(context.Context) (http.CookieJar, error)
} = (*Google)(nil)
