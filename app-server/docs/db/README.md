# ku-potato

## Tables

| Name | Columns | Comment | Type |
| ---- | ------- | ------- | ---- |
| [archive_state](archive_state.md) | 3 | 取得履歴と保存ファイル情報の更新順序を採番する論理時計。端末間で共有しないローカル状態 | table |
| [lms_course_retrievals](lms_course_retrievals.md) | 5 | 年度ごとの講義一覧の取得履歴。取得ごとに追記し、過去の一覧を保持する | table |
| [lms_courses](lms_courses.md) | 8 | 講義一覧のスナップショット。LMSの講義IDがない行も表示順を含めて保持する | table |
| [lms_course_material_retrievals](lms_course_material_retrievals.md) | 5 | 講義ごとの教材一覧の取得履歴。空の一覧を取得した場合も記録する | table |
| [lms_course_material_folders](lms_course_material_folders.md) | 5 | 教材一覧の取得時点における教材フォルダー。LMS上では「授業」と表示されるまとまり | table |
| [lms_course_materials](lms_course_materials.md) | 11 | 教材一覧のスナップショット。教材の種類・状態・公開期限と所属フォルダーを保持する | table |
| [lms_material_resource_retrievals](lms_material_resource_retrievals.md) | 5 | 教材ごとの資料一覧の取得履歴。未取得と、取得済みの空一覧を区別する | table |
| [lms_material_resources](lms_material_resources.md) | 10 | 資料一覧のスナップショット。ファイルや外部リンクの情報を取得時点のまま保持する | table |
| [lms_saved_files](lms_saved_files.md) | 8 | LMSのファイル資料ごとの現在の保存ファイル。成功時だけ置き換え、公開終了後も保持する | table |
| [google_drive_saved_files](google_drive_saved_files.md) | 6 | Google Driveのファイルごとの現在の保存ファイル。LMSの取得履歴とは独立して保持する | table |
| [lms_report_detail_retrievals](lms_report_detail_retrievals.md) | 5 | レポート教材ごとの詳細の取得履歴。取得ごとに追記する | table |
| [lms_report_details](lms_report_details.md) | 11 | レポート詳細のスナップショット。提出期間・修正条件・回答形式を保持する | table |

## Relations

```mermaid
erDiagram

"lms_courses" |o--|| "lms_course_retrievals" : "FOREIGN KEY (retrieval_id) REFERENCES lms_course_retrievals (id) ON UPDATE NO ACTION ON DELETE NO ACTION MATCH NONE"
"lms_course_material_folders" |o--|| "lms_course_material_retrievals" : "FOREIGN KEY (retrieval_id) REFERENCES lms_course_material_retrievals (id) ON UPDATE NO ACTION ON DELETE NO ACTION MATCH NONE"
"lms_course_materials" }o--|| "lms_course_material_folders" : "FOREIGN KEY (retrieval_id, folder_position) REFERENCES lms_course_material_folders (retrieval_id, position) ON UPDATE NO ACTION ON DELETE NO ACTION MATCH NONE"
"lms_material_resources" |o--|| "lms_material_resource_retrievals" : "FOREIGN KEY (retrieval_id) REFERENCES lms_material_resource_retrievals (id) ON UPDATE NO ACTION ON DELETE NO ACTION MATCH NONE"
"lms_saved_files" }o--|| "lms_material_resource_retrievals" : "FOREIGN KEY (resource_retrieval_id, lms_material_id) REFERENCES lms_material_resource_retrievals (id, lms_material_id) ON UPDATE NO ACTION ON DELETE NO ACTION MATCH NONE"
"lms_saved_files" }o--|| "lms_material_resources" : "FOREIGN KEY (resource_retrieval_id, lms_resource_id) REFERENCES lms_material_resources (retrieval_id, lms_resource_id) ON UPDATE NO ACTION ON DELETE NO ACTION MATCH NONE"
"lms_report_details" |o--|| "lms_report_detail_retrievals" : "FOREIGN KEY (retrieval_id) REFERENCES lms_report_detail_retrievals (id) ON UPDATE NO ACTION ON DELETE NO ACTION MATCH NONE"

"archive_state" {
  INTEGER singleton
  INTEGER clock_millis
  INTEGER clock_counter
}
"lms_course_retrievals" {
  TEXT id PK
  INTEGER retrieved_at
  INTEGER timestamp_millis
  INTEGER timestamp_counter
  INTEGER academic_year
}
"lms_courses" {
  TEXT retrieval_id PK
  INTEGER position PK
  TEXT lms_course_id
  TEXT name
  TEXT availability
  TEXT type
  INTEGER weekday
  INTEGER period
}
"lms_course_material_retrievals" {
  TEXT id PK
  INTEGER retrieved_at
  INTEGER timestamp_millis
  INTEGER timestamp_counter
  TEXT lms_course_id
}
"lms_course_material_folders" {
  TEXT retrieval_id PK
  INTEGER position PK
  TEXT name
  TEXT class_date
  TEXT description_html
}
"lms_course_materials" {
  TEXT retrieval_id PK
  INTEGER position PK
  INTEGER folder_position FK
  TEXT lms_material_id
  TEXT name
  TEXT type
  TEXT status
  BOOLEAN material_link_available
  TEXT publication_deadline_kind
  INTEGER publication_deadline_at
  TEXT resource_availability
}
"lms_material_resource_retrievals" {
  TEXT id PK
  INTEGER retrieved_at
  INTEGER timestamp_millis
  INTEGER timestamp_counter
  TEXT lms_material_id
}
"lms_material_resources" {
  TEXT retrieval_id PK
  INTEGER position PK
  TEXT lms_resource_id
  TEXT name
  TEXT type
  TEXT status
  TEXT registered_on
  TEXT first_viewed_on
  TEXT description
  TEXT url
}
"lms_saved_files" {
  TEXT lms_material_id PK
  TEXT lms_resource_id PK
  TEXT content_hash
  TEXT original_filename
  INTEGER original_size
  TEXT resource_retrieval_id FK
  INTEGER timestamp_millis
  INTEGER timestamp_counter
}
"google_drive_saved_files" {
  TEXT file_id PK
  TEXT content_hash
  TEXT original_filename
  INTEGER original_size
  INTEGER timestamp_millis
  INTEGER timestamp_counter
}
"lms_report_detail_retrievals" {
  TEXT id PK
  INTEGER retrieved_at
  INTEGER timestamp_millis
  INTEGER timestamp_counter
  TEXT lms_material_id
}
"lms_report_details" {
  TEXT retrieval_id PK
  TEXT prompt_html
  TEXT status
  TEXT submission_period_kind
  INTEGER submission_starts_at
  INTEGER submission_due_at
  TEXT correction_mode
  INTEGER correction_limit
  BOOLEAN text_answer_allowed
  BOOLEAN file_answer_allowed
  INTEGER max_total_file_bytes
}
```

---

> Generated by [tbls](https://github.com/k1LoW/tbls)
