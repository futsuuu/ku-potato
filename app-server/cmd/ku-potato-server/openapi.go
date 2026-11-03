package main

import (
	"flag"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"

	"github.com/futsuuu/ku-potato/app-server/httpapi"
)

func runOpenAPI(args []string) error {
	flags := flag.NewFlagSet("openapi", flag.ContinueOnError)
	output := flags.String("out", "", "write the OpenAPI schema to a file")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if flags.NArg() != 0 {
		return fmt.Errorf("unexpected OpenAPI arguments: %v", flags.Args())
	}

	w := httptest.NewRecorder()
	httpapi.New(nil, "127.0.0.1:8787").
		ServeHTTP(w, httptest.NewRequest("GET", "http://127.0.0.1:8787/openapi.json", nil))
	if w.Code != http.StatusOK {
		return fmt.Errorf("OpenAPI generation failed: HTTP %d", w.Code)
	}
	if *output != "" {
		return os.WriteFile(*output, w.Body.Bytes(), 0o644)
	}
	_, err := os.Stdout.Write(w.Body.Bytes())
	return err
}
