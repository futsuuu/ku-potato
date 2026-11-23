# Read cached authentication state

- **Method:** `GET`
- **Path:** `/auth`
- **Operation ID:** `getCachedAuthenticationState`

Returns the last observed LMS authentication state without starting an authentication check.

## Effective servers

- `/`

## Responses

### 200

**Content type:** `application/json`

schema: [Data_Authentication](schemas/Data_Authentication.md)

- **`data` (required)**

  **One of:**
  - `object`
    - **`status` (required)**: `string`, possible values: `"unknown"`
  - `object`
    - **`status` (required)**: `string`, possible values: `"authenticated"`
  - `object`
    - **`status` (required)**: `string`, possible values: `"unauthenticated"`

### 403

**Content type:** `application/json`

schema: [ErrorBody](schemas/ErrorBody.md)

- **`error` (required)**: [Public](schemas/Public.md)

[API index](README.md)
