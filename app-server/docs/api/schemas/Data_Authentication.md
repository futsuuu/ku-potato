# Data\_Authentication

**Type:** `object`

- **`data` (required)**

  **One of:**
  - `object`
    - **`status` (required)**: `string`, possible values: `"unknown"`
  - `object`
    - **`status` (required)**: `string`, possible values: `"authenticated"`
  - `object`
    - **`status` (required)**: `string`, possible values: `"unauthenticated"`

**Example:**

```json
{
  "data": {
    "status": "unknown"
  }
}
```

[API index](../README.md)
