// The only composition root: concrete outbound and inbound adapters meet here.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/futsuuu/ku-potato/app-server/application"
	"github.com/futsuuu/ku-potato/app-server/authstate"
	chromedp "github.com/futsuuu/ku-potato/app-server/browserauth"
	"github.com/futsuuu/ku-potato/app-server/browserworker"
	"github.com/futsuuu/ku-potato/app-server/filesystem"
	"github.com/futsuuu/ku-potato/app-server/googledrive"
	"github.com/futsuuu/ku-potato/app-server/httpapi"
	"github.com/futsuuu/ku-potato/app-server/sqlite"
	"github.com/futsuuu/ku-potato/internal/appdirs"
)

func main() {
	if len(os.Args) > 1 && os.Args[1] == "openapi" {
		if err := runOpenAPI(os.Args[2:]); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		return
	}
	if err := run(); err != nil {
		slog.Error("server stopped", "error", err)
		os.Exit(1)
	}
}

func run() error {
	defaults, err := appdirs.DefaultDirectories()
	if err != nil {
		return err
	}
	listen := flag.String("listen", "127.0.0.1:8787", "loopback HTTP listen address")
	data := flag.String("data-dir", defaults.Data, "archive and acquired files directory")
	state := flag.String("state-dir", defaults.State, "authentication and process state directory")
	cache := flag.String("cache-dir", defaults.Cache, "disposable browser cache directory")
	temp := flag.String(
		"temp-dir",
		defaults.Temp,
		"parent directory for per-process temporary files",
	)
	parallel := flag.Int("concurrency", 4, "maximum parallel browser contexts and job workers")
	executable := flag.String("chrome", "", "Chrome or Chromium executable path")
	workerBinary := flag.String(
		"worker",
		"",
		"browser worker executable (defaults to adjacent binary)",
	)
	timeout := flag.Duration("job-timeout", 2*time.Minute, "non-interactive job timeout")
	flag.Parse()
	if *timeout <= 0 {
		return fmt.Errorf("job-timeout must be positive")
	}
	if *parallel < 1 || *parallel > 32 {
		return fmt.Errorf("concurrency must be between 1 and 32")
	}
	address, err := loopbackAddress(*listen)
	if err != nil {
		return err
	}
	root, err := filepath.Abs(*data)
	if err != nil {
		return err
	}
	if err = os.MkdirAll(root, 0o700); err != nil {
		return err
	}
	lock, err := acquireServerLock(defaults.State)
	if err != nil {
		return err
	}
	defer lock.Close()
	for _, dir := range []string{*state, *cache, *temp} {
		if err := os.MkdirAll(dir, 0o700); err != nil {
			return err
		}
	}
	tempRoot, err := filepath.Abs(*temp)
	if err != nil {
		return err
	}
	processTemp, err := os.MkdirTemp(tempRoot, "ku-potato-server-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(processTemp)
	store, err := sqlite.Open(filepath.Join(root, "archive.sqlite"))
	if err != nil {
		return err
	}
	defer store.Close()
	files, err := filesystem.New(filepath.Join(root, "resources"))
	if err != nil {
		return err
	}
	authBrowser, err := chromedp.New(chromedp.Options{
		StateDir: *state, ProfileDir: filepath.Join(*state, "user-profile"),
		CacheDir:   filepath.Join(*cache, "user-browser"),
		Executable: *executable,
	})
	if err != nil {
		return err
	}
	defer authBrowser.Close()
	lmsAuth := chromedp.NewLMSAuthenticator(authBrowser)
	google := chromedp.NewGoogle(authBrowser)
	materializer, err := filesystem.NewMaterializer(tempRoot)
	if err != nil {
		return err
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	workerProcess, err := browserworker.Start(
		ctx,
		*workerBinary,
		processTemp,
		*executable,
		*parallel,
	)
	if err != nil {
		return err
	}
	defer workerProcess.Close()
	downloads := filepath.Join(processTemp, "downloads")
	if err := os.MkdirAll(downloads, 0o700); err != nil {
		return err
	}
	content := browserworker.New(workerProcess.Client, lmsAuth, downloads)
	application := application.New(
		content,
		store,
		authstate.NewAuthenticationState(),
		files,
		*timeout,
		*parallel,
		application.WithLMSAuthentication(lmsAuth),
		application.WithGoogle(google, authstate.NewAuthenticationState()),
		application.WithExternalDownloader(googledrive.New(google, downloads)),
		application.WithResourceMaterializer(materializer),
	)
	listener, err := net.Listen("tcp", address)
	if err != nil {
		return err
	}
	defer listener.Close()
	server := &http.Server{
		Handler:           httpapi.New(application, listener.Addr().String()),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		IdleTimeout:       60 * time.Second,
		MaxHeaderBytes:    16 << 10,
	}
	workerCtx, cancel := context.WithCancel(ctx)
	server.BaseContext = func(net.Listener) context.Context { return workerCtx }
	defer cancel()
	workerDone := make(chan error, 1)
	go func() { workerDone <- application.Run(workerCtx) }()
	serverDone := make(chan error, 1)
	go func() { serverDone <- server.Serve(listener) }()
	slog.Info("HTTP server listening",
		"url", "http://"+listener.Addr().String(),
		"dataDir", root,
		"stateDir", *state,
		"cacheDir", *cache,
		"tempDir", processTemp,
		"concurrency", *parallel,
	)
	var result error
	workerExited := false
	select {
	case <-ctx.Done():
	case result = <-workerDone:
		workerExited = true
	case result = <-serverDone:
		if errors.Is(result, http.ErrServerClosed) {
			result = nil
		}
	case result = <-workerProcess.Done:
		if result == nil {
			result = errors.New("browser worker exited")
		}
	}
	cancel()
	shutdown, cancelShutdown := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancelShutdown()
	if err := server.Shutdown(shutdown); err != nil {
		_ = server.Close()
		if result == nil {
			result = err
		}
	}
	if !workerExited {
		select {
		case err := <-workerDone:
			if result == nil {
				result = err
			}
		case <-shutdown.Done():
			if result == nil {
				result = shutdown.Err()
			}
		}
	}
	return result
}

func loopbackAddress(value string) (string, error) {
	host, port, err := net.SplitHostPort(value)
	if err != nil {
		return "", err
	}
	if host == "localhost" {
		host = "127.0.0.1"
	}
	ip := net.ParseIP(host)
	if ip == nil || !ip.IsLoopback() {
		return "", fmt.Errorf("listen address must be a loopback IP or localhost")
	}
	return net.JoinHostPort(host, port), nil
}
