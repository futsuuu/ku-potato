// Package grpcprocess starts token-authenticated local gRPC child processes.
package grpcprocess

import (
	"bufio"
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"io"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/metadata"
)

type Options struct {
	Executable  string
	Name        string
	Arguments   []string
	TokenEnv    string
	TokenHeader string
}

type Process struct {
	Connection *grpc.ClientConn
	Endpoint   string
	Done       <-chan error
	stop       context.CancelFunc
	exited     <-chan struct{}
	closeOnce  sync.Once
	closeErr   error
}

func (p *Process) Close() error {
	p.closeOnce.Do(func() {
		p.stop()
		<-p.exited
		p.closeErr = p.Connection.Close()
	})
	return p.closeErr
}

func Start(ctx context.Context, opts Options) (*Process, error) {
	executable := opts.Executable
	if executable == "" {
		binary, err := os.Executable()
		if err != nil {
			return nil, err
		}
		executable = filepath.Join(filepath.Dir(binary), opts.Name)
		if filepath.Ext(binary) == ".exe" {
			executable += ".exe"
		}
	}
	if runtime.GOOS == "windows" && filepath.Ext(executable) != ".exe" {
		executable += ".exe"
	}
	secret := make([]byte, 32)
	if _, err := rand.Read(secret); err != nil {
		return nil, err
	}
	token := hex.EncodeToString(secret)
	childCtx, stop := context.WithCancel(ctx)
	command := exec.CommandContext(childCtx, executable, opts.Arguments...)
	configureProcess(command)
	command.Env = append(os.Environ(), opts.TokenEnv+"="+token)
	parentRead, parentWrite, err := os.Pipe()
	if err != nil {
		stop()
		return nil, err
	}
	// Closing stdin asks the service to stop gRPC and flush its Chrome profile.
	// CommandContext still kills a stuck service after the shutdown deadline.
	command.Cancel = parentWrite.Close
	command.WaitDelay = 15 * time.Second
	command.Stdin = parentRead
	stdout, err := command.StdoutPipe()
	if err != nil {
		_ = parentRead.Close()
		_ = parentWrite.Close()
		stop()
		return nil, err
	}
	command.Stderr = os.Stderr
	if err = command.Start(); err != nil {
		_ = parentRead.Close()
		_ = parentWrite.Close()
		stop()
		return nil, err
	}
	_ = parentRead.Close()
	done := make(chan error, 1)
	exited := make(chan struct{})
	go func() {
		done <- command.Wait()
		_ = parentWrite.Close()
		close(exited)
	}()
	address := make(chan string, 1)
	go func() {
		line, _ := bufio.NewReader(stdout).ReadString('\n')
		address <- strings.TrimSpace(line)
		_, _ = io.Copy(io.Discard, stdout)
	}()
	abort := func(err error) (*Process, error) {
		stop()
		<-exited
		return nil, err
	}
	var endpoint string
	select {
	case endpoint = <-address:
	case <-time.After(15 * time.Second):
		return abort(errors.New(opts.Name + " did not start"))
	case <-ctx.Done():
		return abort(ctx.Err())
	}
	host, _, err := net.SplitHostPort(endpoint)
	if err != nil || host != "127.0.0.1" {
		return abort(errors.New("invalid " + opts.Name + " address"))
	}
	unary := func(ctx context.Context, method string, request, response any, conn *grpc.ClientConn, next grpc.UnaryInvoker, options ...grpc.CallOption) error {
		return next(metadata.AppendToOutgoingContext(ctx, opts.TokenHeader, token),
			method, request, response, conn, options...)
	}
	stream := func(ctx context.Context, desc *grpc.StreamDesc, conn *grpc.ClientConn, method string, next grpc.Streamer, options ...grpc.CallOption) (grpc.ClientStream, error) {
		return next(metadata.AppendToOutgoingContext(ctx, opts.TokenHeader, token),
			desc, conn, method, options...)
	}
	connection, err := grpc.NewClient(
		"passthrough:///"+endpoint,
		grpc.WithTransportCredentials(insecure.NewCredentials()),
		grpc.WithUnaryInterceptor(unary),
		grpc.WithStreamInterceptor(stream),
	)
	if err != nil {
		return abort(err)
	}
	return &Process{
		Connection: connection,
		Endpoint:   endpoint,
		Done:       done,
		stop:       stop,
		exited:     exited,
	}, nil
}
