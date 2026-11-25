# Acquire and save a Google Drive file

- **Method:** `POST`
- **Path:** `/google-drive/files/download`
- **Operation ID:** `downloadGoogleDriveFile`

Returns SSE status events followed by exactly one result or error event, then closes. Disconnecting detaches observation; execution continues. Repeat the request to observe equivalent active work.

## Effective servers

- `/`

## Request body

**Required:** `true`

**Content type:** `application/json`

schema: [GoogleDriveDownloadInput](schemas/GoogleDriveDownloadInput.md), no additional properties

- **`url` (required)**: `string`, format: `uri`

**Example:**

```json
{
  "url": "https://drive.google.com/file/d/drive_file-123/view"
}
```

## Responses

### 200

**Content type:** `text/event-stream`

array of [StreamEvent\_GoogleDriveDownload](schemas/StreamEvent_GoogleDriveDownload.md)

### 400, 403

- `400`
- `403`

**Content type:** `application/json`

schema: [ErrorBody](schemas/ErrorBody.md)

- **`error` (required)**: [Public](schemas/Public.md)

[API index](README.md)
