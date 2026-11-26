# Read saved WebAuthn credential state

- **Method:** `GET`
- **Path:** `/auth/webauthn`
- **Operation ID:** `getWebAuthn`

Reports whether a saved virtual WebAuthn credential is registered.

## Effective servers

- `/`

## Responses

### 200

**Content type:** `application/json`

schema: [Data\_Registration](schemas/Data_Registration.md)

- **`data` (required)**: `object`
  - **`registered` (required)**: `boolean`

### 403, 502, 503, 504

- `403`
- `502` The user browser failed to read credential state.
- `503` The user browser service is unavailable.
- `504` The credential state request timed out.

**Content type:** `application/json`

schema: [ErrorBody](schemas/ErrorBody.md)

- **`error` (required)**: [HttpError](schemas/HttpError.md)

  A failure to handle an HTTP request, not the outcome of a streamed operation.

[API index](README.md)
