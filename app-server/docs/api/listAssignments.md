# Read or synchronize assignments

- **Method:** `GET`
- **Path:** `/assignments`
- **Operation ID:** `listAssignments`

Returns SSE status events followed by exactly one result or error event, then closes. Disconnecting detaches observation; execution continues. Repeat the request to observe equivalent active work.

## Effective servers

- `/`

## Query parameters

- **`sync`**: `string`, possible values: `"auto", "true", "false"`

  auto reads saved data or starts synchronization; false reads only; true starts synchronization.
- **`courseId`**: `array`, maxItems: `500`, style: `form`, explode: `true`

  Repeat to select courses; omission uses the courses selected by the synchronization policy.

  **Array of:**

  `string`, minLength: `1`, maxLength: `200`

## Responses

### 200

**Content type:** `text/event-stream`

array of [StreamEvent\_Assignments](schemas/StreamEvent_Assignments.md)

### 400, 403

- `400`
- `403`

**Content type:** `application/json`

schema: [ErrorBody](schemas/ErrorBody.md)

- **`error` (required)**: [Public](schemas/Public.md)

[API index](README.md)
