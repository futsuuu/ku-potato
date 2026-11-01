package main

import (
	"context"
	"fmt"
	"os"
	"time"

	"github.com/futsuuu/ku-potato/desktop/launcher"
	"github.com/futsuuu/ku-potato/internal/appdirs"
	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
)

type App struct {
	ctx context.Context
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
}

func (a *App) server() (resourceOpener, error) {
	if endpoint := os.Getenv("KU_POTATO_SERVER_URL"); endpoint != "" {
		return resourceOpener{endpoint: endpoint}, nil
	}
	ctx, cancel := context.WithTimeout(a.ctx, 20*time.Second)
	defer cancel()
	dirs, err := appdirs.DefaultDirectories()
	if err != nil {
		return resourceOpener{}, err
	}
	endpoint, err := (launcher.Manager{StateDir: dirs.State}).Ensure(ctx)
	return resourceOpener{endpoint: endpoint, sharedFiles: true}, err
}

func (a *App) ServerURL() (string, error) {
	server, err := a.server()
	return server.endpoint, err
}

func (a *App) OpenResource(material, resource string) error {
	opener, err := a.server()
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(a.ctx, 2*time.Minute)
	defer cancel()
	if err := opener.open(ctx, material, resource, openDefault); err != nil {
		return fmt.Errorf("ファイルを開けませんでした。接続先と既定のアプリを確認してください: %w", err)
	}
	return nil
}

func main() {
	app := &App{}
	err := wails.Run(&options.App{
		Title: "KU-POTATO", Width: 1120, Height: 780, MinWidth: 760, MinHeight: 560,
		AssetServer:      &assetserver.Options{Assets: assets},
		BackgroundColour: options.NewRGB(247, 248, 250),
		OnStartup:        app.startup, Bind: []interface{}{app},
	})
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
