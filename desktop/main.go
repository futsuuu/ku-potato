package main

import (
	"context"
	"fmt"
	"os"
	"runtime"
	"time"

	"github.com/futsuuu/ku-potato/desktop/launcher"
	"github.com/futsuuu/ku-potato/internal/appdirs"
	"github.com/wailsapp/wails/v3/pkg/application"
)

type App struct{}

func (a *App) server(ctx context.Context) (resourceOpener, error) {
	if endpoint := os.Getenv("KU_POTATO_SERVER_URL"); endpoint != "" {
		return resourceOpener{endpoint: endpoint}, nil
	}
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	dirs, err := appdirs.DefaultDirectories()
	if err != nil {
		return resourceOpener{}, err
	}
	endpoint, err := (launcher.Manager{StateDir: dirs.State}).Ensure(ctx)
	return resourceOpener{endpoint: endpoint, sharedFiles: true}, err
}

func (a *App) ServerURL(ctx context.Context) (string, error) {
	server, err := a.server(ctx)
	return server.endpoint, err
}

func (a *App) OpenResource(ctx context.Context, material, resource string) error {
	opener, err := a.server(ctx)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()
	if err := opener.open(ctx, material, resource, openDefault); err != nil {
		return fmt.Errorf("ファイルを開けませんでした。接続先と既定のアプリを確認してください: %w", err)
	}
	return nil
}

func mainWindowOptions() application.WebviewWindowOptions {
	return application.WebviewWindowOptions{
		Title: "KU-POTATO", Width: 1120, Height: 780, MinWidth: 760, MinHeight: 560,
		Frameless:          runtime.GOOS == "windows",
		ZoomControlEnabled: runtime.GOOS == "windows",
		// Keep HWND hosting for native touchpad scrolling and gestures.
		Windows:                    application.WindowsWindow{NonClientRegionSupport: true},
		BackgroundColour:           application.NewRGB(247, 248, 250),
		DefaultContextMenuDisabled: true,
	}
}

func main() {
	app := application.New(application.Options{
		Name:     "KU-POTATO",
		Services: []application.Service{application.NewService(&App{})},
		Assets: application.AssetOptions{
			Handler: application.BundledAssetFileServer(assets),
		},
		Mac: application.MacOptions{
			ApplicationShouldTerminateAfterLastWindowClosed: true,
		},
	})
	app.Window.NewWithOptions(mainWindowOptions())
	if err := app.Run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
