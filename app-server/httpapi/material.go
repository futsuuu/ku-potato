package httpapi

import (
	"maps"

	"github.com/danielgtaylor/huma/v2"
	"github.com/futsuuu/ku-potato/app-server/domain"
)

// The schema alias applies to materials nested in every API response without
// adding an HTTP dependency to the domain or changing the JSON representation.
type material domain.Material

func (material) TransformSchema(_ huma.Registry, base *huma.Schema) *huma.Schema {
	union := &huma.Schema{}
	for _, kind := range base.Properties["type"].Enum {
		variant := *base
		variant.Properties = maps.Clone(base.Properties)
		tag, status := *base.Properties["type"], *base.Properties["status"]
		tag.Enum = []any{kind}
		status.Enum = nil
		for _, value := range domain.MaterialStatuses(kind.(string)) {
			status.Enum = append(status.Enum, value)
		}
		variant.Properties["type"], variant.Properties["status"] = &tag, &status
		union.OneOf = append(union.OneOf, &variant)
	}
	return union
}
