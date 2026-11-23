# Materialize a saved resource for local clients

- **Method:** `POST`
- **Path:** `/materials/{materialId}/resources/{resourceId}/prepare`
- **Operation ID:** `prepareResource`

Verifies and materializes saved content and returns its local filesystem path. Does not download missing content.

## Effective servers

- `/`

## Path parameters

- **`materialId` (required)**: `string`, maxLength: `200`, pattern: `^[A-Z]+[0-9]+$`
- **`resourceId` (required)**: `string`, maxLength: `200`, pattern: `^SRS[0-9]+$`

## Responses

### 200

**Content type:** `application/json`

schema: [Data_ResourcePath](schemas/Data_ResourcePath.md)

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
