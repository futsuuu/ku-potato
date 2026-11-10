// Generate Jet types from a fresh SQLite database, never from user data.
package main

import (
	"bytes"
	"database/sql"
	"flag"
	"fmt"
	"log"
	"os"
	"path/filepath"

	"github.com/futsuuu/ku-potato/app-server/sqlite/schema"
	"github.com/go-jet/jet/v2/generator/sqlite"
	_ "modernc.org/sqlite"
)

func main() {
	if err := run(); err != nil {
		log.Fatal(err)
	}
}

func run() error {
	destination := flag.String("out", "app-server/sqlite/gen", "generated code directory")
	check := flag.Bool("check", false, "check committed code without modifying it")
	flag.Parse()
	output := *destination
	if *check {
		temporary, err := os.MkdirTemp("", "ku-potato-db-codegen-")
		if err != nil {
			return err
		}
		defer func() { _ = os.RemoveAll(temporary) }()
		output = temporary
	}
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		return err
	}
	defer func() { _ = db.Close() }()
	db.SetMaxOpenConns(1)
	if _, err := db.Exec(schema.SQL); err != nil {
		return err
	}
	if err := sqlite.GenerateDB(db, output); err != nil {
		return err
	}
	if *check {
		if err := compare(output, *destination); err != nil {
			return err
		}
		if err := compare(*destination, output); err != nil {
			return err
		}
	}
	return nil
}

func compare(source, destination string) error {
	return filepath.WalkDir(source, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() {
			return nil
		}
		relative, err := filepath.Rel(source, path)
		if err != nil {
			return err
		}
		expected, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		actual, err := os.ReadFile(filepath.Join(destination, relative))
		if err != nil || !bytes.Equal(expected, actual) {
			return fmt.Errorf(
				"generated database types are stale (%s); run vp run app-server:db:generate",
				relative,
			)
		}
		return nil
	})
}
