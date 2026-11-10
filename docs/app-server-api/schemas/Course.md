# Course

**Type:** `object`, no additional properties

- **`availability` (required)**: `string`, possible values: `"available", "unavailable"`
- **`name` (required)**: `string`
- **`academicYear`**: `integer`, format: `int64`, minimum: `1`, maximum: `9999`
- **`archived`**: `boolean`
- **`lmsCourseId`**: `string`
- **`period`**: `integer`, format: `int64`, minimum: `1`
- **`type`**: `string`, possible values: `"scheduled", "other", "unknown"`
- **`weekday`**: `integer`, format: `int64`, minimum: `1`, maximum: `7`

**Example:**

```json
{
  "academicYear": 1,
  "archived": true,
  "availability": "available",
  "lmsCourseId": "",
  "name": "",
  "period": 1,
  "type": "scheduled",
  "weekday": 1
}
```

[API index](../README.md)
