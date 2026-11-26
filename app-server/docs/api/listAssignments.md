# Read or synchronize assignments

- **Method:** `GET`
- **Path:** `/assignments`
- **Operation ID:** `listAssignments`

Valid requests return HTTP 200 with SSE status events followed by exactly one result or error event, then close. Operation outcomes do not change the HTTP status: authentication-required is blocked, cancelled is cancelled, and other errors are failed. HTTP errors describe request rejection before streaming. Disconnecting detaches observation; execution continues. Repeat the request to observe equivalent active work.

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

- **`error` (required)**: [HttpError](schemas/HttpError.md)

  A failure to handle an HTTP request, not the outcome of a streamed operation.

[API index](README.md)
