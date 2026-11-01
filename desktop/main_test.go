package main

import (
	"context"
	"testing"
)

func TestConfiguredServerNeverUsesSharedPaths(t *testing.T) {
	for _, endpoint := range []string{"http://127.0.0.1:8787", "http://localhost:9876", "https://server.example"} {
		t.Run(endpoint, func(t *testing.T) {
			t.Setenv("KU_POTATO_SERVER_URL", endpoint)
			ctx, cancel := context.WithCancel(context.Background())
			cancel()
			app := &App{ctx: ctx}
			server, err := app.server()
			if err != nil || server.endpoint != endpoint || server.sharedFiles {
				t.Fatal("configured endpoint was treated as a managed server", server, err)
			}
			if url, err := app.ServerURL(); err != nil || url != endpoint {
				t.Fatal("frontend and native endpoints differ", url, err)
			}
		})
	}
}
