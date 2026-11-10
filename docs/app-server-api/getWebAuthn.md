# Read saved WebAuthn credential state

- **Method:** `GET`
- **Path:** `/auth/webauthn`
- **Operation ID:** `getWebAuthn`

## Effective servers

- `/`

## Responses

### 200 OK

**Content type:** `application/json`

schema: [DataBodyRegistrationResult](schemas/DataBodyRegistrationResult.md), no additional properties

- **`data` (required)**: [RegistrationResult](schemas/RegistrationResult.md)

### 400 Bad Request

**Content type:** `application/json`

schema: [ErrorBody](schemas/ErrorBody.md), no additional properties

- **`error` (required)**: [Error](schemas/Error.md)

**Content type:** `application/problem+json`

schema: [ErrorModel](schemas/ErrorModel.md), no additional properties

- **`detail`**: `string`

  A human-readable explanation specific to this occurrence of the problem.
- **`errors`**: array of [ErrorDetail](schemas/ErrorDetail.md) | `null`

  Optional list of individual error details
- **`instance`**: `string`, format: `uri`

  A URI reference that identifies the specific occurrence of the problem.
- **`status`**: `integer`, format: `int64`

  HTTP status code
- **`title`**: `string`

  A short, human-readable summary of the problem type. This value should not change between occurrences of the error.
- **`type`**: `string`, format: `uri`, default: `"about:blank"`

  A URI reference to human-readable documentation for the error.

### 403, 404, 409, 500

- `403` Forbidden
- `404` Not Found
- `409` Conflict
- `500` Internal Server Error

**Content type:** `application/json`

*Schema `ErrorBody` is shown above.*

### 408, 413, 415, 422

- `408` Request Timeout
- `413` Request Entity Too Large
- `415` Unsupported Media Type
- `422` Unprocessable Entity

**Content type:** `application/problem+json`

*Schema `ErrorModel` is shown above.*

[API index](README.md)
