package userbrowser

import (
	"context"

	"github.com/futsuuu/ku-potato/internal/grpcprocess"
	userproto "github.com/futsuuu/ku-potato/user-browser/protocol"
)

type Process struct {
	*grpcprocess.Process
	Client userproto.UserBrowserClient
}

func Start(
	ctx context.Context,
	executable, state, cache, chrome string,
	siteURLs ...string,
) (*Process, error) {
	args := []string{"-state-dir", state, "-cache-dir", cache, "-chrome", chrome}
	if len(siteURLs) == 2 {
		args = append(args, "-lms-url", siteURLs[0], "-sso-url", siteURLs[1])
	}
	process, err := grpcprocess.Start(ctx, grpcprocess.Options{
		Executable: executable, Name: "ku-potato-user-browser", Arguments: args,
		TokenEnv: "KU_POTATO_USER_BROWSER_TOKEN", TokenHeader: "x-ku-potato-user-browser-token",
	})
	if err != nil {
		return nil, err
	}
	return &Process{
		Process: process,
		Client:  userproto.NewUserBrowserClient(process.Connection),
	}, nil
}
