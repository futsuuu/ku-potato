# Acquire and save a Google Drive file

- **Method:** `POST`
- **Path:** `/google-drive/files/download`
- **Operation ID:** `downloadGoogleDriveFile`

Valid requests return HTTP 200 with SSE status events followed by exactly one result or error event, then close. Operation outcomes do not change the HTTP status: authentication-required is blocked, cancelled is cancelled, and other errors are failed. HTTP errors describe request rejection before streaming. Disconnecting detaches observation; execution continues. Repeat the request to observe equivalent active work.

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

### 400, 403, 413

- `400`
- `403`
- `413`

**Content type:** `application/json`

schema: [ErrorBody](schemas/ErrorBody.md)

- **`error` (required)**: [HttpError](schemas/HttpError.md)

  A failure to handle an HTTP request, not the outcome of a streamed operation.

[API index](README.md)
