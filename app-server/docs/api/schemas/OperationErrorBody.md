# OperationErrorBody

**Type:** `object`

- **`error` (required)**: [OperationError](OperationError.md)

  A public operation outcome, carried by SSE or a partial-result entry.

**Example:**

```json
{
  "error": {
    "message": "The browser operation was cancelled",
    "reason": "cancelled"
  }
}
```

[API index](../README.md)
