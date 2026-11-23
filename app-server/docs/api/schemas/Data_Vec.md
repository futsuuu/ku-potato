# Data_Vec

**Type:** `object`

- **`data` (required)**: `array`

  **Items:**

  **All of:**
  - [Access](Access.md)
  - [Schedule](Schedule.md)
  - `object`
    - **`academicYear` (required)**: `integer`, format: `int32`, minimum: `1`, maximum: `9999`
    - **`name` (required)**: `string`
    - **`archived`**: `boolean`

**Example:**

```json
{
  "data": [
    {
      "academicYear": 1,
      "archived": true,
      "name": ""
    }
  ]
}
```

[API index](../README.md)
