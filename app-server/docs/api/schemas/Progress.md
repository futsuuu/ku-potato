# Progress

**Type:** `object`

- **`completed` (required)**: `integer`, minimum: `0`
- **`stage` (required)**: `string`, possible values: `"waiting", "authenticating", "registering", "fetching-courses", "fetching-materials", "fetching-resources", "downloading", "saving", "completed"`
- **`total` (required)**: `integer`, minimum: `0`
- **`lmsCourseId`**: `string | null`, minLength: `1`, maxLength: `200`

**Example:**

```json
{
  "completed": 0,
  "lmsCourseId": "",
  "stage": "waiting",
  "total": 0
}
```

[API index](../README.md)
