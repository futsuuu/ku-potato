# Materialize a saved Google Drive file for local clients

- **Method:** `POST`
- **Path:** `/google-drive/files/{fileId}/prepare`
- **Operation ID:** `prepareGoogleDriveFile`

Verifies and materializes a saved Google Drive file and returns its local filesystem path. Does not download missing content.

## Effective servers

- `/`

## Path parameters

- **`fileId` (required)**: `string`, minLength: `1`, maxLength: `256`, pattern: `^[A-Za-z0-9_-]+$`

## Responses

### 200

**Content type:** `application/json`

schema: [Data\_ResourcePath](schemas/Data_ResourcePath.md)

- **`data` (required)**: `object`
  - **`path` (required)**: `string`

### 400, 403, 404, 500

- `400`
- `403`
- `404`
- `500`

**Content type:** `application/json`

schema: [ErrorBody](schemas/ErrorBody.md)

- **`error` (required)**: [Public](schemas/Public.md)

[API index](README.md)
