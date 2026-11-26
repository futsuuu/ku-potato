# Check HTTP process

- **Method:** `GET`
- **Path:** `/healthz`
- **Operation ID:** `health`

Reports HTTP process availability without starting browser work.

## Effective servers

- `/`

## Responses

### 200

**Content type:** `application/json`

schema: [Health](schemas/Health.md)

- **`service` (required)**: `string`
- **`status` (required)**: `string`

### 403

**Content type:** `application/json`

schema: [ErrorBody](schemas/ErrorBody.md)

- **`error` (required)**: [HttpError](schemas/HttpError.md)

  A failure to handle an HTTP request, not the outcome of a streamed operation.

[API index](README.md)
