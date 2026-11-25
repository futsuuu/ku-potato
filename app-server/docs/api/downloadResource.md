# Acquire and save an LMS file or return an external link

- **Method:** `POST`
- **Path:** `/materials/{materialId}/resources/{resourceId}/download`
- **Operation ID:** `downloadResource`

Returns SSE status events followed by exactly one result or error event, then closes. Disconnecting detaches observation; execution continues. Repeat the request to observe equivalent active work.

## Effective servers

- `/`

## Path parameters

- **`materialId` (required)**: `string`, maxLength: `200`, pattern: `^[A-Z]+[0-9]+$`
- **`resourceId` (required)**: `string`, maxLength: `200`, pattern: `^SRS[0-9]+$`

## Responses

### 200

**Content type:** `text/event-stream`

array of [StreamEvent\_Download](schemas/StreamEvent_Download.md)

### 400, 403

- `400`
- `403`

**Content type:** `application/json`

schema: [ErrorBody](schemas/ErrorBody.md)

- **`error` (required)**: [Public](schemas/Public.md)

[API index](README.md)
