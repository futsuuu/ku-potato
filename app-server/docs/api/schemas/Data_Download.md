# Data\_Download

**Type:** `object`

- **`data` (required)**

  **One of:**
  - `object`
    - **`downloadUrl` (required)**: `string`
    - **`file` (required)**: [SavedFile](SavedFile.md)
    - **`type` (required)**: `string`, possible values: `"file"`
  - `object`
    - **`type` (required)**: `string`, possible values: `"external"`
    - **`url` (required)**: `string`, format: `uri`

**Example:**

```json
{
  "data": {
    "downloadUrl": "",
    "file": {},
    "type": "file"
  }
}
```

[API index](../README.md)
