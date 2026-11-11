package main

import (
	"context"
	"crypto/subtle"
	"errors"
	"flag"
	"fmt"
	"io"
	"net"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"

	"github.com/futsuuu/ku-potato/user-browser"
	chromedp "github.com/futsuuu/ku-potato/user-browser/browser"
	userproto "github.com/futsuuu/ku-potato/user-browser/protocol"
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

func run() error {
	listen := flag.String("listen", "127.0.0.1:0", "local user browser listener")
	state := flag.String("state-dir", "", "persistent authentication state directory")
	cache := flag.String("cache-dir", "", "disposable user browser cache directory")
	chrome := flag.String("chrome", "", "Chrome executable")
	lmsURL := flag.String("lms-url", "https://study.ns.kogakuin.ac.jp", "LMS origin")
	ssoURL := flag.String("sso-url", "https://slink.secioss.com", "SSO origin")
	flag.Parse()
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
		StateDir: *state, ProfileDir: filepath.Join(*state, "user-profile"),
		CacheDir: *cache, Executable: *chrome, LMSURL: *lmsURL, SSOURL: *ssoURL,
	})
	if err != nil {
		return err
	}
	defer func() { _ = browser.Close() }()
	if err := ctx.Err(); err != nil {
		return err
	}
	listener, err := net.Listen("tcp", *listen)
	if err != nil {
		return err
	}
	defer func() { _ = listener.Close() }()
	server := grpc.NewServer(grpc.UnaryInterceptor(
		func(ctx context.Context, req any, info *grpc.UnaryServerInfo, next grpc.UnaryHandler) (any, error) {
			values, ok := metadata.FromIncomingContext(ctx)
			if !ok || len(values.Get("x-ku-potato-user-browser-token")) != 1 ||
				subtle.ConstantTimeCompare(
					[]byte(values.Get("x-ku-potato-user-browser-token")[0]),
					[]byte(token),
				) != 1 {
				return nil, status.Error(codes.Unauthenticated, "unauthorized user browser client")
			}
			return next(ctx, req)
		},
	))
	userproto.RegisterUserBrowserServer(server, userbrowser.NewServer(
		chromedp.NewLMSAuthenticator(browser), chromedp.NewGoogle(browser),
	))
	if _, err := fmt.Fprintln(os.Stdout, listener.Addr().String()); err != nil {
		return err
	}
	go func() { <-ctx.Done(); server.Stop() }()
	err = server.Serve(listener)
	if errors.Is(err, grpc.ErrServerStopped) {
		return nil
	}
	return err
}
