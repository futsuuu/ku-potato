package domain

import "testing"

func TestArchiveRetainsRemovedEntriesAndRestoresCurrent(t *testing.T) {
	old := CourseMaterials{CourseID: "KOG1", Folders: []Folder{{Name: "old", Materials: []Material{{ID: "SRY1"}, {ID: "SRY2"}}}}}
	current := CourseMaterials{CourseID: "KOG1", Folders: []Folder{{Name: "new", Materials: []Material{{ID: "SRY1"}}}}}
	merged := MergeMaterials(old, current)
	if len(merged.Folders) != 2 || len(merged.Folders[0].Materials) != 1 || merged.Folders[0].Materials[0].Archived || !merged.Folders[1].Materials[0].Archived {
		t.Fatalf("unexpected merged archive: %#v", merged)
	}
	file := &SavedFile{ID: "saved"}
	resources := MergeResources([]Resource{{ID: "SRS1", SavedFile: file}, {ID: "SRS2"}}, []Resource{{ID: "SRS1", Name: "renamed"}})
	if resources[0].SavedFile != file || resources[0].Name != "renamed" || resources[1].Availability != "archived" {
		t.Fatalf("lost resource state: %#v", resources)
	}
	courses := MergeCourses([]Course{{ID: "KOG1"}, {ID: "KOG2"}}, []Course{{ID: "KOG1"}})
	if len(courses) != 2 || !courses[1].Archived {
		t.Fatal(courses)
	}
}
