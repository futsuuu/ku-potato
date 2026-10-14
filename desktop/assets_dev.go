//go:build dev

package main

import "embed"

// Wails serves the frontend dev server in this build.
var assets embed.FS
