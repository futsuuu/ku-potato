package browserworker

import (
	"bufio"
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	workerproto "github.com/futsuuu/ku-potato/browser-worker/protocol"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/metadata"
)

type Process struct {
	Client     workerproto.BrowserWorkerClient
	connection *grpc.ClientConn
	endpoint   string
	stop       context.CancelFunc
	Done       <-chan error
	exited     <-chan struct{}
}

func (p *Process) Close() error {
	p.stop()
	<-p.exited
	return p.connection.Close()
}

func Start(ctx context.Context, executable, temp, chrome string, parallel int, siteURLs ...string) (*Process, error) {
	if executable == "" {
		binary, err := os.Executable()
		if err != nil {
			return nil, err
		}
		executable = filepath.Join(filepath.Dir(binary), "ku-potato-browser-worker")
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
	workerCtx, stop := context.WithCancel(ctx)
	args := []string{"-temp-dir", temp, "-chrome", chrome, "-concurrency", fmt.Sprint(parallel)}
	if len(siteURLs) == 2 {
		args = append(args, "-lms-url", siteURLs[0], "-sso-url", siteURLs[1])
	}
	command := exec.CommandContext(workerCtx, executable, args...)
	configureWorkerProcess(command)
	command.Env = append(os.Environ(), "KU_POTATO_WORKER_TOKEN="+token)
	parentRead, parentWrite, err := os.Pipe()
	if err != nil {
		stop()
		return nil, err
	}
	command.Stdin = parentRead
	stdout, err := command.StdoutPipe()
	if err != nil {
		parentRead.Close()
		parentWrite.Close()
		stop()
		return nil, err
	}
	command.Stderr = os.Stderr
	if err = command.Start(); err != nil {
		parentRead.Close()
		parentWrite.Close()
		stop()
		return nil, err
	}
	parentRead.Close()
	done := make(chan error, 1)
	exited := make(chan struct{})
	go func() {
		done <- command.Wait()
		parentWrite.Close()
		close(exited)
	}()
	address := make(chan string, 1)
	go func() {
		line, _ := bufio.NewReader(stdout).ReadString('\n')
		address <- strings.TrimSpace(line)
		io.Copy(io.Discard, stdout)
	}()
	var endpoint string
	select {
	case endpoint = <-address:
	case <-time.After(15 * time.Second):
		stop()
		<-exited
		return nil, errors.New("browser worker did not start")
	case <-ctx.Done():
		stop()
		<-exited
		return nil, ctx.Err()
	}
	host, _, err := net.SplitHostPort(endpoint)
	if err != nil || host != "127.0.0.1" {
		stop()
		<-exited
		return nil, errors.New("invalid browser worker address")
	}
	unary := func(ctx context.Context, method string, request, response any, conn *grpc.ClientConn, next grpc.UnaryInvoker, opts ...grpc.CallOption) error {
		return next(metadata.AppendToOutgoingContext(ctx, "x-ku-potato-worker-token", token), method, request, response, conn, opts...)
	}
	stream := func(ctx context.Context, desc *grpc.StreamDesc, conn *grpc.ClientConn, method string, next grpc.Streamer, opts ...grpc.CallOption) (grpc.ClientStream, error) {
		return next(metadata.AppendToOutgoingContext(ctx, "x-ku-potato-worker-token", token), desc, conn, method, opts...)
	}
	connection, err := grpc.NewClient("passthrough:///"+endpoint, grpc.WithTransportCredentials(insecure.NewCredentials()), grpc.WithUnaryInterceptor(unary), grpc.WithStreamInterceptor(stream))
	if err != nil {
		stop()
		<-exited
		return nil, err
	}
	return &Process{Client: workerproto.NewBrowserWorkerClient(connection), connection: connection, endpoint: endpoint, stop: stop, Done: done, exited: exited}, nil
}
