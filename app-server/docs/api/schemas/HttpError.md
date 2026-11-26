# HttpError

**Type:** `object`

A failure to handle an HTTP request, not the outcome of a streamed operation.

- **`message` (required)**: `string`
- **`reason` (required)**: `string`, possible values: `"invalid-input", "payload-too-large", "forbidden", "not-found", "archive-data-missing", "archive", "resource-storage", "dependency-failed", "dependency-unavailable", "dependency-timeout", "internal"`

**Example:**

```json
{
  "message": "",
  "reason": "invalid-input"
}
```

[API index](../README.md)
