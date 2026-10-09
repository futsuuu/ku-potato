package domain

func MergeCourses(old, current []Course) []Course {
	result := append([]Course{}, current...)
	seen := map[string]bool{}
	key := func(c Course) string {
		if c.ID != "" {
			return "id:" + c.ID
		}
		return "name:" + c.Name
	}
	for _, c := range current {
		seen[key(c)] = true
	}
	for _, c := range old {
		if !seen[key(c)] {
			c.Archived = true
			result = append(result, c)
		}
	}
	return result
}
func MergeMaterials(old, current CourseMaterials) CourseMaterials {
	seen := map[string]bool{}
	result := CourseMaterials{CourseID: current.CourseID, Folders: []Folder{}}
	for _, f := range current.Folders {
		copyFolder := f
		copyFolder.Materials = append([]Material{}, f.Materials...)
		result.Folders = append(result.Folders, copyFolder)
		for _, m := range f.Materials {
			seen[m.ID] = true
		}
	}
	for _, f := range old.Folders {
		retained := []Material{}
		for _, m := range f.Materials {
			if !seen[m.ID] {
				m.Archived = true
				retained = append(retained, m)
			}
		}
		if len(retained) == 0 {
			continue
		}
		index := -1
		for i, c := range result.Folders {
			if c.Name == f.Name && c.ClassDate == f.ClassDate {
				index = i
				break
			}
		}
		if index >= 0 {
			result.Folders[index].Materials = append(result.Folders[index].Materials, retained...)
		} else {
			f.Materials = retained
			result.Folders = append(result.Folders, f)
		}
	}
	return result
}
func MergeResources(old, current []Resource) []Resource {
	previous := map[string]Resource{}
	for _, r := range old {
		previous[r.ID] = r
	}
	result := []Resource{}
	seen := map[string]bool{}
	for _, r := range current {
		if p, ok := previous[r.ID]; ok {
			r.SavedFile = p.SavedFile
			r.Acquisition = p.Acquisition
		}
		r.Availability = "current"
		seen[r.ID] = true
		result = append(result, r)
	}
	for _, r := range old {
		if !seen[r.ID] {
			r.Availability = "archived"
			result = append(result, r)
		}
	}
	return result
}
