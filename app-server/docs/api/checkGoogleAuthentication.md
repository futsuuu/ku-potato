# Check the saved Google session

- **Method:** `POST`
- **Path:** `/auth/google/check`
- **Operation ID:** `checkGoogleAuthentication`

Returns SSE status events followed by exactly one result or error event, then closes. Disconnecting detaches observation; execution continues. Repeat the request to observe equivalent active work.

## Effective servers

- `/`

## Responses

### 200

**Content type:** `text/event-stream`

array of [StreamEvent\_Authentication](schemas/StreamEvent_Authentication.md)

### 403

**Content type:** `application/json`

schema: [ErrorBody](schemas/ErrorBody.md)

- **`error` (required)**: [Public](schemas/Public.md)

[API index](README.md)
