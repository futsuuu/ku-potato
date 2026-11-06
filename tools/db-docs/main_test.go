package main

import (
	"testing"

	tblsschema "github.com/k1LoW/tbls/schema"
)

func TestAddCommentsCRLF(t *testing.T) {
	document := &tblsschema.Schema{Tables: []*tblsschema.Table{{
		Name: "example",
		Def:  "CREATE TABLE example (\r\n    -- テーブルの説明\r\n    id INTEGER PRIMARY KEY -- 識別子\r\n);",
		Columns: []*tblsschema.Column{{
			Name: "id",
		}},
	}}}
	addComments(document)
	if got := document.Tables[0].Comment; got != "テーブルの説明" {
		t.Errorf("table comment = %q", got)
	}
	if got := document.Tables[0].Columns[0].Comment; got != "識別子" {
		t.Errorf("column comment = %q", got)
	}
}
