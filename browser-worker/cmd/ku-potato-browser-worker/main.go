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
	"path/filepath"
	"syscall"
	"time"

	"github.com/futsuuu/ku-potato/browser-worker"
	chromedp "github.com/futsuuu/ku-potato/browser-worker/browser"
	workerproto "github.com/futsuuu/ku-potato/browser-worker/protocol"
	"github.com/futsuuu/ku-potato/internal/telemetry"
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
	listen := flag.String("listen", "127.0.0.1:0", "local worker listener")
	directory := flag.String("temp-dir", "", "worker private temporary directory")
	chrome := flag.String("chrome", "", "Chrome executable")
	lmsURL := flag.String("lms-url", "https://study.ns.kogakuin.ac.jp", "LMS origin")
	ssoURL := flag.String("sso-url", "https://slink.secioss.com", "SSO origin")
	parallel := flag.Int("concurrency", 4, "maximum browser pages")
	telemetryDirectory := flag.String("telemetry-dir", "", "telemetry recording directory")
	flag.Parse()
	shutdown, err := telemetry.Init(context.Background(), "browser-worker", *telemetryDirectory)
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
	token := os.Getenv("KU_POTATO_WORKER_TOKEN")
	if token == "" || *parallel < 1 || *parallel > 32 {
		return errors.New("missing or invalid worker configuration")
	}
	host, _, err := net.SplitHostPort(*listen)
	if err != nil || host != "127.0.0.1" {
		return errors.New("worker must listen on IPv4 loopback")
	}
	root, err := os.MkdirTemp(*directory, "ku-potato-browser-worker-")
	if err != nil {
		return err
	}
	defer func() { _ = os.RemoveAll(root) }()
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go func() {
		_, _ = io.Copy(io.Discard, os.Stdin)
		stop()
	}()
	browser, err := chromedp.New(
		chromedp.Options{
			StateDir:    root,
			ProfileDir:  filepath.Join(root, "profile"),
			CacheDir:    filepath.Join(root, "cache"),
			DownloadDir: filepath.Join(root, "downloads"),
			Executable:  *chrome,
			Parallelism: *parallel,
			LMSURL:      *lmsURL,
			SSOURL:      *ssoURL,
		},
	)
	if err != nil {
		return err
	}
	defer func() { _ = browser.Close() }()
	if err := ctx.Err(); err != nil {
		return err
	}
	worker, err := browserworker.NewServer(
		browser,
		browserworker.NewScheduler(ctx, *parallel),
		*ssoURL,
	)
	if err != nil {
		return err
	}
	listener, err := net.Listen("tcp", *listen)
	if err != nil {
		return err
	}
	defer func() { _ = listener.Close() }()
	authorize := func(ctx context.Context) error {
		values, ok := metadata.FromIncomingContext(ctx)
		if !ok || len(values.Get("x-ku-potato-worker-token")) != 1 ||
			subtle.ConstantTimeCompare(
				[]byte(values.Get("x-ku-potato-worker-token")[0]),
				[]byte(token),
			) != 1 {
			return status.Error(codes.Unauthenticated, "unauthorized worker client")
		}
		return nil
	}
	server := grpc.NewServer(
		grpc.WaitForHandlers(true),
		grpc.StatsHandler(otelgrpc.NewServerHandler()),
		grpc.ChainUnaryInterceptor(
			telemetry.UnaryServerInterceptor(),
			func(ctx context.Context, req any, info *grpc.UnaryServerInfo, next grpc.UnaryHandler) (any, error) {
				if err := authorize(ctx); err != nil {
					return nil, err
				}
				return next(ctx, req)
			},
		),
		grpc.ChainStreamInterceptor(
			telemetry.StreamServerInterceptor(),
			func(srv any, stream grpc.ServerStream, info *grpc.StreamServerInfo, next grpc.StreamHandler) error {
				if err := authorize(stream.Context()); err != nil {
					return err
				}
				return next(srv, stream)
			},
		),
	)
	workerproto.RegisterBrowserWorkerServer(server, worker)
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
