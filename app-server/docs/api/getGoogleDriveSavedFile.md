# Serve a saved Google Drive file

- **Method:** `GET`
- **Path:** `/google-drive/files/{fileId}/file`
- **Operation ID:** `getGoogleDriveSavedFile`

Serves verified Google Drive content with range requests and ETag conditionals. Does not download missing content.

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
