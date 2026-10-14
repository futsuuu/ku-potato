package main

import (
	"context"
	"encoding/base64"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/futsuuu/ku-potato/desktop/launcher"
	"github.com/futsuuu/ku-potato/server/platform"
	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

type App struct {
	ctx context.Context
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
}

// ServerURL resolves the endpoint; API features use frontend fetch.
func (a *App) ServerURL() (string, error) {
	ctx, cancel := context.WithTimeout(a.ctx, 20*time.Second)
	defer cancel()
	dirs, err := platform.DefaultDirectories()
	if err != nil {
		return "", err
	}
	return (launcher.Manager{StateDir: dirs.State}).Ensure(ctx)
}

func (a *App) SaveFile(filename, content string) (bool, error) {
	filename = filepath.Base(strings.ReplaceAll(filename, "\\", "/"))
	path, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{Title: "資料を保存", DefaultFilename: filename})
	if err != nil || path == "" {
		return false, err
	}
	data, err := base64.StdEncoding.DecodeString(content)
	if err != nil {
		return false, fmt.Errorf("ファイルの内容を読み取れませんでした")
	}
	if err := os.WriteFile(path, data, 0600); err != nil {
		return false, err
	}
	return true, nil
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
