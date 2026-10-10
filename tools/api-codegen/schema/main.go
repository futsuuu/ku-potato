package main

import (
	"fmt"
	"net/http/httptest"
	"os"

	"github.com/futsuuu/ku-potato/server/httpapi"
)

func main() {
	w := httptest.NewRecorder()
	httpapi.New(nil, "127.0.0.1:8787").ServeHTTP(w, httptest.NewRequest("GET", "http://127.0.0.1:8787/openapi.json", nil))
	if w.Code != 200 {
		fmt.Fprintln(os.Stderr, "OpenAPI generation failed")
		os.Exit(1)
	}
	_, _ = os.Stdout.Write(w.Body.Bytes())
}
