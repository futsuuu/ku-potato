# Read or synchronize courses

- **Method:** `GET`
- **Path:** `/courses`
- **Operation ID:** `listCourses`

Returns SSE status events followed by exactly one result or error event, then closes. Disconnecting detaches observation; execution continues. Repeat the request to observe equivalent active work.

## Effective servers

- `/`

## Query parameters

- **`sync`**: `string`, possible values: `"auto", "true", "false"`

  auto reads saved data or starts synchronization; false reads only; true starts synchronization.

## Responses

### 200

**Content type:** `text/event-stream`

array of [StreamEvent\_Vec\_Course](schemas/StreamEvent_Vec_Course.md)

### 400, 403

- `400`
- `403`

**Content type:** `application/json`

schema: [ErrorBody](schemas/ErrorBody.md)

- **`error` (required)**: [Public](schemas/Public.md)

[API index](README.md)
