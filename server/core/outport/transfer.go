package outport

import "github.com/futsuuu/ku-potato/server/domain"

// ObservationIDs identify the histories committed by Archive.Append.
// Downloads attach saved files to that observation, not to the latest retrieval.
type ObservationIDs struct {
	Courses, Materials, Resources, Report int64
}

// Download is a content source's result before the application saves a file.
type Download struct {
	Snapshot domain.Snapshot
	Path     string
	Filename string
	URL      string
}
