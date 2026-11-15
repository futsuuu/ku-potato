# Register virtual WebAuthn credential

- **Method:** `POST`
- **Path:** `/auth/webauthn`
- **Operation ID:** `registerWebAuthn`

Returns SSE status events followed by exactly one result or error event, then closes. Disconnecting detaches observation; execution continues. Repeat the request to observe equivalent active work.

## Effective servers

- `/`

## Request body

**Required:** `true`

**Content type:** `application/json`

schema: [AuthenticationInput](schemas/AuthenticationInput.md), no additional properties

Set interactive to allow manual authentication in a visible browser on the server machine.

- **`interactive`**: `boolean`, default: `false`

## Responses

### 200

**Content type:** `text/event-stream`

array of [StreamEvent_Registration](schemas/StreamEvent_Registration.md)

### 400, 403, 413

- `400`
- `403`
- `413`

**Content type:** `application/json`

schema: [ErrorBody](schemas/ErrorBody.md)

- **`error` (required)**: [Public](schemas/Public.md)

[API index](README.md)
