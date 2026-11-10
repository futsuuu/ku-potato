# Progress

**Type:** `object`, no additional properties

- **`completed` (required)**: `integer`, format: `int64`, minimum: `0`
- **`stage` (required)**: `string`, possible values: `"waiting", "authenticating", "logging-out", "registering", "fetching-courses", "fetching-materials", "fetching-resources", "downloading", "saving", "completed"`
- **`total` (required)**: `integer`, format: `int64`, minimum: `0`
- **`lmsCourseId`**: `string`

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
