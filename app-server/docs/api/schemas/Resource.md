# Resource

**All of:**

- [ResourceContent](ResourceContent.md)
- `object`
  - **`lmsResourceId` (required)**: `string`, maxLength: `200`, pattern: `^SRS[0-9]+$`
  - **`name` (required)**: `string`
  - **`status` (required)**: `string`, possible values: `"unviewed", "viewed", "unknown"`
  - **`archived`**: `boolean`
  - **`description`**: `string | null`
  - **`firstViewedOn`**: `string | null`, format: `date`
  - **`registeredOn`**: `string | null`, format: `date`
  - **`savedFile`**: [SavedFile](SavedFile.md) | `null`

[API index](../README.md)
