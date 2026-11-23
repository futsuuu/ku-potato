package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/k1LoW/tbls/config"
	tblsschema "github.com/k1LoW/tbls/schema"
)

func TestAddCommentsCRLF(t *testing.T) {
	document := &tblsschema.Schema{Tables: []*tblsschema.Table{
		{
			Name: "example",
			Def:  "CREATE TABLE example (\r\n    -- Table description\r\n    id INTEGER PRIMARY KEY -- Identifier\r\n);",
			Columns: []*tblsschema.Column{{
				Name: "id",
			}},
		},
	}}
	addComments(document)
	if got := document.Tables[0].Comment; got != "Table description" {
		t.Errorf("table comment = %q", got)
	}
	if got := document.Tables[0].Columns[0].Comment; got != "Identifier" {
		t.Errorf("column comment = %q", got)
	}
}

func TestDocumentationMatchesSchema(t *testing.T) {
	t.Chdir(filepath.Join("..", "..", ".."))
	t.Setenv("TBLS_DOC_PATH", "")

	c, err := config.New()
	if err != nil {
		t.Fatal(err)
	}
	if err := c.Load("app-server/.tbls.yml"); err != nil {
		t.Fatal(err)
	}
	document, err := analyze(filepath.Join(t.TempDir(), "schema.db"))
	if err != nil {
		t.Fatal(err)
	}
	for _, table := range document.Tables {
		if strings.TrimSpace(table.Comment) == "" {
			t.Errorf("missing description for table %s", table.Name)
		}
		for _, column := range table.Columns {
			if strings.TrimSpace(column.Comment) == "" {
				t.Errorf("missing description for column %s.%s", table.Name, column.Name)
			}
		}
	}

	output := t.TempDir()
	t.Setenv("TBLS_DOC_PATH", output)
	if err := run("app-server/.tbls.yml"); err != nil {
		t.Fatal(err)
	}
	generated, err := os.ReadDir(output)
	if err != nil {
		t.Fatal(err)
	}
	if len(generated) != len(document.Tables)+1 {
		t.Fatalf("generated %d files for %d tables", len(generated), len(document.Tables))
	}
	committed, err := os.ReadDir(c.DocPath)
	if err != nil {
		t.Fatal(err)
	}
	if len(committed) != len(generated) {
		t.Errorf("documentation has %d files; schema generates %d", len(committed), len(generated))
	}
	for _, entry := range generated {
		got, err := os.ReadFile(filepath.Join(output, entry.Name()))
		if err != nil {
			t.Fatal(err)
		}
		path := filepath.Join(c.DocPath, entry.Name())
		want, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		if strings.ReplaceAll(
			string(got),
			"\r\n",
			"\n",
		) != strings.ReplaceAll(
			string(want),
			"\r\n",
			"\n",
		) {
			t.Errorf("%s is stale; run vp run app-server:db:docs", path)
		}
	}
}
