# Read or synchronize material details

- **Method:** `GET`
- **Path:** `/materials/{materialId}`
- **Operation ID:** `getMaterial`

Returns SSE status events followed by exactly one result or error event, then closes. Disconnecting detaches observation; execution continues. Repeat the request to observe equivalent active work.

## Effective servers

- `/`

## Path parameters

- **`materialId` (required)**: `string`, maxLength: `200`, pattern: `^[A-Z]+[0-9]+$`

## Query parameters

- **`sync`**: `string`, possible values: `"auto", "true", "false"`

  auto reads saved data or starts synchronization; false reads only; true starts synchronization.

## Responses

### 200

**Content type:** `text/event-stream`

array of [StreamEvent\_Detail](schemas/StreamEvent_Detail.md)

### 400, 403

- `400`
- `403`

**Content type:** `application/json`

schema: [ErrorBody](schemas/ErrorBody.md)

- **`error` (required)**: [Public](schemas/Public.md)

[API index](README.md)
