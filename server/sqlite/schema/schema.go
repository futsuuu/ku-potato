// Package schema contains the initial SQLite schema shared by initialization and code generation.
package schema

import _ "embed"

//go:embed schema.sql
var SQL string
