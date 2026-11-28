package main

import (
	"context"
	"crypto/subtle"
	"errors"
	"flag"
	"fmt"
	"io"
	"log/slog"
	"net"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/futsuuu/ku-potato/internal/appdirs"
	"github.com/futsuuu/ku-potato/internal/telemetry"
	"github.com/futsuuu/ku-potato/user-browser"
	chromedp "github.com/futsuuu/ku-potato/user-browser/browser"
	userproto "github.com/futsuuu/ku-potato/user-browser/protocol"
	"go.opentelemetry.io/contrib/instrumentation/google.golang.org/grpc/otelgrpc"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run() (err error) {
	directories, err := appdirs.DefaultDirectories("user-browser")
	if err != nil {
		return err
	}
	listen := flag.String("listen", "127.0.0.1:0", "local user browser listener")
	state := flag.String(
		"state-dir",
		directories.State,
		"persistent authentication state directory",
	)
	cache := flag.String("cache-dir", directories.Cache, "disposable user browser cache directory")
	chrome := flag.String("chrome", "", "Chrome executable")
	lmsURL := flag.String("lms-url", "https://study.ns.kogakuin.ac.jp", "LMS origin")
	ssoURL := flag.String("sso-url", "https://slink.secioss.com", "SSO origin")
	telemetryDirectory := flag.String("telemetry-dir", "", "telemetry recording directory")
	flag.Parse()
	shutdown, err := telemetry.Init(context.Background(), "user-browser", *telemetryDirectory)
	if err != nil {
		return err
	}
	defer func() {
		if err != nil {
			slog.Error("Service failed", "error", err)
		}
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		err = errors.Join(err, shutdown(ctx))
	}()
	token := os.Getenv("KU_POTATO_USER_BROWSER_TOKEN")
	if token == "" || *state == "" || *cache == "" {
		return errors.New("missing user browser configuration")
	}
	host, _, err := net.SplitHostPort(*listen)
	if err != nil || host != "127.0.0.1" {
		return errors.New("user browser must listen on IPv4 loopback")
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go func() { _, _ = io.Copy(io.Discard, os.Stdin); stop() }()
	browser, err := chromedp.New(chromedp.Options{
		StateDir: *state, CacheDir: *cache, Executable: *chrome, LMSURL: *lmsURL, SSOURL: *ssoURL,
	})
	if err != nil {
		return err
	}
	defer func() { err = errors.Join(err, browser.Close()) }()
	if err := ctx.Err(); err != nil {
		return err
	}
	listener, err := net.Listen("tcp", *listen)
	if err != nil {
		return err
	}
	defer func() { _ = listener.Close() }()
	server := grpc.NewServer(
		grpc.WaitForHandlers(true),
		grpc.StatsHandler(otelgrpc.NewServerHandler()),
		grpc.ChainUnaryInterceptor(
			telemetry.UnaryServerInterceptor(),
			func(ctx context.Context, req any, info *grpc.UnaryServerInfo, next grpc.UnaryHandler) (any, error) {
				values, ok := metadata.FromIncomingContext(ctx)
				if !ok || len(values.Get("x-ku-potato-user-browser-token")) != 1 ||
					subtle.ConstantTimeCompare(
						[]byte(values.Get("x-ku-potato-user-browser-token")[0]),
						[]byte(token),
					) != 1 {
					return nil, status.Error(
						codes.Unauthenticated,
						"unauthorized user browser client",
					)
				}
				return next(ctx, req)
			},
		),
	)
	userproto.RegisterUserBrowserServer(server, userbrowser.NewServer(
		chromedp.NewKogakuinSSO(browser), chromedp.NewGoogle(browser),
	))
	if _, err := fmt.Fprintln(os.Stdout, listener.Addr().String()); err != nil {
		return err
	}
	go func() { <-ctx.Done(); server.Stop() }()
	slog.Info("gRPC server listening", "address", listener.Addr().String())
	err = server.Serve(listener)
	if errors.Is(err, grpc.ErrServerStopped) {
		return nil
	}
	return err
}
