# CourseFailure

**Type:** `object`

- **`error` (required)**: [OperationError](OperationError.md)

  A public operation outcome, carried by SSE or a partial-result entry.
- **`lmsCourseId` (required)**: `string`, minLength: `1`, maxLength: `200`

**Example:**

```json
{
  "error": {},
  "lmsCourseId": ""
}
```

[API index](../README.md)
