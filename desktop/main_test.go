package main

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"runtime"
	"testing"
)

func TestMainWindowKeepsNativeWebViewInput(t *testing.T) {
	options := mainWindowOptions()
	if options.Windows.WebView2CompositionHosting {
		t.Fatal("composition hosting loses native touchpad gestures")
	}
	if !options.Windows.NonClientRegionSupport {
		t.Fatal("native header dragging must remain enabled")
	}
	windows := runtime.GOOS == "windows"
	if options.Frameless != windows || options.ZoomControlEnabled != windows {
		t.Fatal("frameless chrome and zoom controls must only be enabled on Windows")
	}
}

func TestOpenResourceRespectsCallCancellation(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		t.Error("canceled call reached the server")
	}))
	defer server.Close()
	t.Setenv("KU_POTATO_SERVER_URL", server.URL)
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	if err := (&App{}).OpenResource(ctx, "SRY1", "SRS1"); !errors.Is(err, context.Canceled) {
		t.Fatal("call cancellation was lost", err)
	}
}

func TestConfiguredServerNeverUsesSharedPaths(t *testing.T) {
	for _, endpoint := range []string{"http://127.0.0.1:8787", "http://localhost:9876", "https://server.example"} {
		t.Run(endpoint, func(t *testing.T) {
			t.Setenv("KU_POTATO_SERVER_URL", endpoint)
			ctx, cancel := context.WithCancel(context.Background())
			cancel()
			app := &App{}
			server, err := app.server(ctx)
			if err != nil || server.endpoint != endpoint || server.sharedFiles {
				t.Fatal("configured endpoint was treated as a managed server", server, err)
			}
			if url, err := app.ServerURL(ctx); err != nil || url != endpoint {
				t.Fatal("frontend and native endpoints differ", url, err)
			}
		})
	}
}
