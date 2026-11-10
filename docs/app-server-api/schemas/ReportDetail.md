# ReportDetail

**Type:** `object`, no additional properties

- **`correctionMode` (required)**: `string`, possible values: `"unknown", "not-allowed", "unlimited", "limited"`
- **`status` (required)**: `string`, possible values: `"unviewed", "unsubmitted", "submitted", "resubmission-required", "evaluated", "unknown"`
- **`submissionPeriodKind` (required)**: `string`, possible values: `"at", "unlisted", "unknown"`
- **`correctionLimit`**: `integer`, format: `int64`, minimum: `0`
- **`fileAnswerAllowed`**: `boolean`
- **`maxTotalFileBytes`**: `integer`, format: `int64`, minimum: `0`
- **`promptHtml`**: `string`
- **`retrievedAt`**: `string`, format: `date-time`
- **`submissionDueAt`**: `string`, format: `date-time`
- **`submissionStartsAt`**: `string`, format: `date-time`
- **`textAnswerAllowed`**: `boolean`

**Example:**

```json
{
  "correctionLimit": 0,
  "correctionMode": "unknown",
  "fileAnswerAllowed": true,
  "maxTotalFileBytes": 0,
  "promptHtml": "",
  "retrievedAt": "",
  "status": "unviewed",
  "submissionDueAt": "",
  "submissionPeriodKind": "at",
  "submissionStartsAt": "",
  "textAnswerAllowed": true
}
```

[API index](../README.md)
