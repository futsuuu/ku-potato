# OperationError

**Type:** `object`

A public operation outcome, carried by SSE or a partial-result entry.

- **`message` (required)**: `string`
- **`reason` (required)**: `string`, possible values: `"conflict", "authentication-required", "archive-data-missing", "material-not-found", "resource-not-found", "course-not-found", "unsupported-resource", "source", "cancelled", "timeout", "internal", "archive", "authentication-storage", "resource-storage", "forbidden", "browser-start"`

**Example:**

```json
{
  "message": "",
  "reason": "conflict"
}
```

[API index](../README.md)
