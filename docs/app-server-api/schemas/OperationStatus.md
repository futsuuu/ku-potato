# OperationStatus

**Type:** `object`, no additional properties

- **`attempt` (required)**: `integer`, format: `int64`, minimum: `0`, maximum: `3`
- **`status` (required)**: `string`, possible values: `"queued", "running", "retrying", "succeeded", "failed", "blocked"`
- **`error`**: [Error](Error.md)
- **`progress`**: [Progress](Progress.md)

**Example:**

```json
{
  "attempt": 0,
  "error": {},
  "progress": {},
  "status": "queued"
}
```

[API index](../README.md)
