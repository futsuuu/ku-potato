# Read or synchronize course materials

- **Method:** `GET`
- **Path:** `/courses/{courseId}/materials`
- **Operation ID:** `listMaterials`

Returns SSE status events followed by exactly one result or error event, then closes. Disconnecting detaches observation; execution continues. Repeat the request to observe equivalent active work.

## Effective servers

- `/`

## Path parameters

- **`courseId` (required)**: `string`, minLength: `1`, maxLength: `200`

## Query parameters

- **`sync`**: `string`, possible values: `"auto", "true", "false"`

  auto reads saved data or starts synchronization; false reads only; true starts synchronization.

## Responses

### 200

**Content type:** `text/event-stream`

array of [StreamEvent_CourseMaterials](schemas/StreamEvent_CourseMaterials.md)

### 400, 403

- `400`
- `403`

**Content type:** `application/json`

schema: [ErrorBody](schemas/ErrorBody.md)

- **`error` (required)**: [Public](schemas/Public.md)

[API index](README.md)
