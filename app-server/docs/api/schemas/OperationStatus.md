# OperationStatus

**Type:** `object`

- **`attempt` (required)**: `integer`, format: `int32`, minimum: `1`
- **`progress` (required)**: [Progress](Progress.md)
- **`status` (required)**: `string`, possible values: `"running", "succeeded", "blocked", "failed"`

**Example:**

```json
{
  "attempt": 1,
  "progress": {},
  "status": "running"
}
```

[API index](../README.md)
