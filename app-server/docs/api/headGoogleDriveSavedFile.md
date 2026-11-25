# Read saved Google Drive file headers

- **Method:** `HEAD`
- **Path:** `/google-drive/files/{fileId}/file`
- **Operation ID:** `headGoogleDriveSavedFile`

Returns the same headers as a Google Drive saved-file GET request without a response body.

## Effective servers

- `/`

## Path parameters

- **`fileId` (required)**: `string`, minLength: `1`, maxLength: `256`, pattern: `^[A-Za-z0-9_-]+$`

## Header parameters

- **`Range`**: `string | null`
- **`If-Range`**: `string | null`
- **`If-None-Match`**: `string | null`

## Responses

### 200

### 206

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
