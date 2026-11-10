# Resource

**Type:** `object`, no additional properties

- **`lmsResourceId` (required)**: `string`
- **`name` (required)**: `string`
- **`type` (required)**: `string`, possible values: `"file", "external", "unknown"`
- **`archived`**: `boolean`
- **`description`**: `string`
- **`firstViewedOn`**: `string`, format: `date`
- **`registeredOn`**: `string`, format: `date`
- **`savedFile`**: [SavedFile](SavedFile.md)
- **`status`**: `string`, possible values: `"unviewed", "viewed", "unknown"`
- **`url`**: `string`, format: `uri`, pattern: `^https?://`

**Example:**

```json
{
  "archived": true,
  "description": "",
  "firstViewedOn": "",
  "lmsResourceId": "",
  "name": "",
  "registeredOn": "",
  "savedFile": {},
  "status": "unviewed",
  "type": "file",
  "url": ""
}
```

[API index](../README.md)
