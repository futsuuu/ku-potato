//go:build !dev

package main

import "embed"

//go:embed all:frontend/dist/client
var assets embed.FS
