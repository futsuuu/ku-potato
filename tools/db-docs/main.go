package main

import (
	"database/sql"
	"log"
	"os"
	"path/filepath"
	"strings"

	"github.com/k1LoW/tbls/config"
	"github.com/k1LoW/tbls/drivers/sqlite"
	"github.com/k1LoW/tbls/output/md"
	tblsschema "github.com/k1LoW/tbls/schema"
	_ "modernc.org/sqlite"
)

func main() {
	if err := run(".tbls.yml"); err != nil {
		log.Fatal(err)
	}
}

func run(configPath string) error {
	dir, err := os.MkdirTemp("", "ku-potato-db-docs-")
	if err != nil {
		return err
	}
	defer func() { _ = os.RemoveAll(dir) }()
	document, err := analyze(filepath.Join(dir, "schema.db"))
	if err != nil {
		return err
	}
	c, err := config.New()
	if err != nil {
		return err
	}
	if err := c.Load(configPath); err != nil {
		return err
	}
	if err := c.ModifySchema(document); err != nil {
		return err
	}
	return md.Output(document, c, true)
}

func analyze(path string) (*tblsschema.Schema, error) {
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}
	defer func() { _ = db.Close() }()
	definition, err := os.ReadFile("app-server/src/archive/schema.sql")
	if err != nil {
		return nil, err
	}
	if _, err := db.Exec(string(definition)); err != nil {
		return nil, err
	}
	document := &tblsschema.Schema{Name: "ku-potato"}
	if err := sqlite.New(db).Analyze(document); err != nil {
		return nil, err
	}
	addComments(document)
	return document, nil
}

func addComments(document *tblsschema.Schema) {
	for _, table := range document.Tables {
		for line := range strings.SplitSeq(table.Def, "\n") {
			definition, comment, ok := strings.Cut(line, "--")
			fields := strings.Fields(definition)
			if !ok {
				continue
			}
			if len(fields) == 0 {
				if table.Comment == "" {
					table.Comment = strings.TrimSpace(comment)
				}
				continue
			}
			for _, column := range table.Columns {
				if column.Name == fields[0] {
					column.Comment = strings.TrimSpace(comment)
				}
			}
		}
	}
}
