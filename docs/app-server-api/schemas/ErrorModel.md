# ErrorModel

**Type:** `object`, no additional properties

- **`detail`**: `string`

  A human-readable explanation specific to this occurrence of the problem.
- **`errors`**: array of [ErrorDetail](ErrorDetail.md) | `null`

  Optional list of individual error details
- **`instance`**: `string`, format: `uri`

  A URI reference that identifies the specific occurrence of the problem.
- **`status`**: `integer`, format: `int64`

  HTTP status code
- **`title`**: `string`

  A short, human-readable summary of the problem type. This value should not change between occurrences of the error.
- **`type`**: `string`, format: `uri`, default: `"about:blank"`

  A URI reference to human-readable documentation for the error.

**Example:**

```json
{
  "detail": "Property foo is required but is missing.",
  "errors": [
    {}
  ],
  "instance": "https://example.com/error-log/abc123",
  "status": 400,
  "title": "Bad Request",
  "type": "https://example.com/errors/example"
}
```

[API index](../README.md)
