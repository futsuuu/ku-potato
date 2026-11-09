package outport

import "github.com/futsuuu/ku-potato/app-server/domain"

// RetrievalIDs identify the histories committed by Archive.Append.
// Downloads attach saved files to that retrieval, not to the latest retrieval.
type RetrievalIDs struct {
	Courses, Materials, Resources, Report int64
}

// Download is a content source's result before the application saves a file.
type Download struct {
	Snapshot            domain.Snapshot
	Path, Filename, URL string
}
