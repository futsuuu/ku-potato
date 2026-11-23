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

schema: [Data_Registration](schemas/Data_Registration.md)

- **`data` (required)**: `object`
  - **`registered` (required)**: `boolean`

### 403, 500

- `403`
- `500`

**Content type:** `application/json`

schema: [ErrorBody](schemas/ErrorBody.md)

- **`error` (required)**: [Public](schemas/Public.md)

[API index](README.md)
