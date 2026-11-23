# Report

**All of:**

- [SubmissionPeriod](SubmissionPeriod.md)
- [Correction](Correction.md)
- `object`
  - **`status` (required)**: `string`, possible values: `"unviewed", "unsubmitted", "submitted", "resubmission-required", "evaluated", "unknown"`
  - **`fileAnswerAllowed`**: `boolean | null`
  - **`maxTotalFileBytes`**: `integer | null`, format: `int64`, minimum: `0`
  - **`promptHtml`**: `string | null`
  - **`retrievedAt`**: `string | null`, format: `date-time`
  - **`textAnswerAllowed`**: `boolean | null`

[API index](../README.md)
