# Read saved file headers

- **Method:** `HEAD`
- **Path:** `/materials/{materialId}/resources/{resourceId}/file`
- **Operation ID:** `headSavedFile`

Returns the same headers as a saved-file GET request without a response body.

## Effective servers

- `/`

## Path parameters

- **`materialId` (required)**: `string`, maxLength: `200`, pattern: `^[A-Z]+[0-9]+$`
- **`resourceId` (required)**: `string`, maxLength: `200`, pattern: `^SRS[0-9]+$`

## Header parameters

- **`Range`**: `string | null`

  Byte range to retrieve.
- **`If-Range`**: `string | null`

  Apply Range only if the saved file's ETag matches.
- **`If-None-Match`**: `string | null`

  Return 304 if the saved file's ETag matches.

## Responses

### 200

### 304

### 400

### 403

### 404

### 500

[API index](README.md)
