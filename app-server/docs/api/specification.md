# Read the generated OpenAPI document

- **Method:** `GET`
- **Path:** `/openapi.json`
- **Operation ID:** `specification`

Generated from the same Rust routes and schemas used by this server.

## Effective servers

- `/`

## Responses

### 200

**Content type:** `application/json`

`any`

### 403

**Content type:** `application/json`

schema: [ErrorBody](schemas/ErrorBody.md)

- **`error` (required)**: [HttpError](schemas/HttpError.md)

  A failure to handle an HTTP request, not the outcome of a streamed operation.

[API index](README.md)
