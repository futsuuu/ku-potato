# Delete saved WebAuthn credential

- **Method:** `DELETE`
- **Path:** `/auth/webauthn`
- **Operation ID:** `deleteWebAuthn`

Valid requests return HTTP 200 with SSE status events followed by exactly one result or error event, then close. Operation outcomes do not change the HTTP status: authentication-required is blocked, cancelled is cancelled, and other errors are failed. HTTP errors describe request rejection before streaming. Disconnecting detaches observation; execution continues. Repeat the request to observe equivalent active work.

## Effective servers

- `/`

## Responses

### 200

**Content type:** `text/event-stream`

array of [StreamEvent\_Registration](schemas/StreamEvent_Registration.md)

### 403

**Content type:** `application/json`

schema: [ErrorBody](schemas/ErrorBody.md)

- **`error` (required)**: [HttpError](schemas/HttpError.md)

  A failure to handle an HTTP request, not the outcome of a streamed operation.

[API index](README.md)
