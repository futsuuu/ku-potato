package browserworker

import (
	"context"
	"fmt"

	workerproto "github.com/futsuuu/ku-potato/browser-worker/protocol"
	"github.com/futsuuu/ku-potato/internal/grpcprocess"
)

type Process struct {
	*grpcprocess.Process
	Client   workerproto.BrowserWorkerClient
	endpoint string
}

func Start(
	ctx context.Context,
	executable, temp, chrome string,
	parallel int,
	siteURLs ...string,
) (*Process, error) {
	args := []string{"-temp-dir", temp, "-chrome", chrome, "-concurrency", fmt.Sprint(parallel)}
	if len(siteURLs) == 2 {
		args = append(args, "-lms-url", siteURLs[0], "-sso-url", siteURLs[1])
	}
	process, err := grpcprocess.Start(ctx, grpcprocess.Options{
		Executable: executable, Name: "ku-potato-browser-worker", Arguments: args,
		TokenEnv: "KU_POTATO_WORKER_TOKEN", TokenHeader: "x-ku-potato-worker-token",
	})
	if err != nil {
		return nil, err
	}
	return &Process{
		Process:  process,
		Client:   workerproto.NewBrowserWorkerClient(process.Connection),
		endpoint: process.Endpoint,
	}, nil
}
