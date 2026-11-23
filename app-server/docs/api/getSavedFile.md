# Serve a saved file

- **Method:** `GET`
- **Path:** `/materials/{materialId}/resources/{resourceId}/file`
- **Operation ID:** `getSavedFile`

Serves verified saved content with range requests and ETag conditionals. Does not download missing content.

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

**Content type:** `application/octet-stream`

`string`, format: `binary`

### 206

**Content type:** `application/octet-stream`

`string`, format: `binary`

### 304

### 400, 403, 404, 500

- `400`
- `403`
- `404`
- `500`

**Content type:** `application/json`

schema: [ErrorBody](schemas/ErrorBody.md)

- **`error` (required)**: [Public](schemas/Public.md)

### 416

[API index](README.md)
