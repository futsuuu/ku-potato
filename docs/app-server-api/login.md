# Log in to LMS

- **Method:** `POST`
- **Path:** `/auth/login`
- **Operation ID:** `login`

Returns SSE status events followed by exactly one result or error event, then closes. Disconnecting detaches observation; execution continues. Repeat the request to observe equivalent active work.

## Effective servers

- `/`

## Request body

**Required:** `true`

**Content type:** `application/json`

schema: [AuthInputBody](schemas/AuthInputBody.md), no additional properties

- **`interactive`**: `boolean`, default: `false`

  Allow manual authentication in a visible browser on the server machine.

## Responses

### 200 OK

**Content type:** `text/event-stream`

Each oneOf object in the array represents one possible Server Sent Events (SSE) message, serialized as UTF-8 text according to the SSE specification.

**Array of:**

**One of:**

- `object`
  - **`data` (required)**: [ErrorBody](schemas/ErrorBody.md)
  - **`event` (required)**: `string`, const: `"error"`

    The event name.
  - **`id`**: `integer`

    The event ID.
  - **`retry`**: `integer`

    The retry time in milliseconds.
- `object`
  - **`data` (required)**: [DataBodyAuthState](schemas/DataBodyAuthState.md)
  - **`event` (required)**: `string`, const: `"result"`

    The event name.
  - **`id`**: `integer`

    The event ID.
  - **`retry`**: `integer`

    The retry time in milliseconds.
- `object`
  - **`data` (required)**: [OperationStatus](schemas/OperationStatus.md)
  - **`event` (required)**: `string`, const: `"status"`

    The event name.
  - **`id`**: `integer`

    The event ID.
  - **`retry`**: `integer`

    The retry time in milliseconds.

### 400, 408, 413, 415, 422

- `400` Bad Request
- `408` Request Timeout
- `413` Request Entity Too Large
- `415` Unsupported Media Type
- `422` Unprocessable Entity

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

### 403 Forbidden

**Content type:** `application/json`

schema: [ErrorBody](schemas/ErrorBody.md), no additional properties

- **`error` (required)**: [Error](schemas/Error.md)

[API index](README.md)
