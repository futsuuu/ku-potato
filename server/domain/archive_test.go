package domain

import (
	"reflect"
	"testing"
)

func TestMergeMaterialsRetainsRemovedEntries(t *testing.T) {
	old := CourseMaterials{CourseID: "KOG1", Folders: []Folder{{Name: "old", Materials: []Material{{ID: "SRY1"}, {ID: "SRY2"}}}}}
	current := CourseMaterials{CourseID: "KOG1", Folders: []Folder{{Name: "new", Materials: []Material{{ID: "SRY1"}}}}}
	merged := MergeMaterials(old, current)
	want := CourseMaterials{CourseID: "KOG1", Folders: []Folder{
		{Name: "new", Materials: []Material{{ID: "SRY1"}}},
		{Name: "old", Materials: []Material{{ID: "SRY2", Archived: true}}},
	}}
	if !reflect.DeepEqual(merged, want) {
		t.Fatalf("merged = %#v, want %#v", merged, want)
	}
}

func TestMergeResourcesRetainsSavedFileAndArchivesRemovedResource(t *testing.T) {
	file := &SavedFile{ID: "saved"}
	resources := MergeResources([]Resource{{ID: "SRS1", SavedFile: file}, {ID: "SRS2"}}, []Resource{{ID: "SRS1", Name: "renamed"}})
	want := []Resource{{ID: "SRS1", Name: "renamed", SavedFile: file, Availability: "current"}, {ID: "SRS2", Availability: "archived"}}
	if !reflect.DeepEqual(resources, want) {
		t.Fatalf("merged = %#v, want %#v", resources, want)
	}
}

func TestMergeCoursesArchivesRemovedCourse(t *testing.T) {
	courses := MergeCourses([]Course{{ID: "KOG1"}, {ID: "KOG2"}}, []Course{{ID: "KOG1"}})
	want := []Course{{ID: "KOG1"}, {ID: "KOG2", Archived: true}}
	if !reflect.DeepEqual(courses, want) {
		t.Fatalf("merged = %#v, want %#v", courses, want)
	}
}
