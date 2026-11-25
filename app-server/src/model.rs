#[derive(Debug, thiserror::Error)]
#[error("Invalid {field}")]
pub struct InvalidValue {
    pub field: &'static str,
}

#[derive(
    utoipa::ToSchema,
    Clone,
    Debug,
    PartialEq,
    Eq,
    PartialOrd,
    Ord,
    Hash,
    serde::Serialize,
    serde::Deserialize,
)]
#[serde(try_from = "String")]
#[schema(min_length = 1, max_length = 200)]
pub struct CourseId(String);

impl TryFrom<String> for CourseId {
    type Error = InvalidValue;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        if value.is_empty() || value.len() > 200 || value.chars().any(char::is_control) {
            return Err(InvalidValue { field: "course ID" });
        }
        Ok(Self(value))
    }
}

impl AsRef<str> for CourseId {
    fn as_ref(&self) -> &str {
        &self.0
    }
}

#[derive(
    utoipa::ToSchema,
    Clone,
    Debug,
    PartialEq,
    Eq,
    PartialOrd,
    Ord,
    Hash,
    serde::Serialize,
    serde::Deserialize,
)]
#[serde(try_from = "String")]
#[schema(max_length = 200, pattern = "^[A-Z]+[0-9]+$")]
pub struct MaterialId(String);

impl TryFrom<String> for MaterialId {
    type Error = InvalidValue;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        let prefix = value.bytes().take_while(u8::is_ascii_uppercase).count();
        if prefix == 0
            || prefix == value.len()
            || value.len() > 200
            || !value.as_bytes()[prefix..].iter().all(u8::is_ascii_digit)
        {
            return Err(InvalidValue {
                field: "material ID",
            });
        }
        Ok(Self(value))
    }
}

impl AsRef<str> for MaterialId {
    fn as_ref(&self) -> &str {
        &self.0
    }
}

#[derive(
    utoipa::ToSchema,
    Clone,
    Debug,
    PartialEq,
    Eq,
    PartialOrd,
    Ord,
    Hash,
    serde::Serialize,
    serde::Deserialize,
)]
#[serde(try_from = "String")]
#[schema(max_length = 200, pattern = "^SRS[0-9]+$")]
pub struct ResourceId(String);

impl TryFrom<String> for ResourceId {
    type Error = InvalidValue;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        if !value.strip_prefix("SRS").is_some_and(|suffix| {
            !suffix.is_empty() && suffix.bytes().all(|byte| byte.is_ascii_digit())
        }) || value.len() > 200
        {
            return Err(InvalidValue {
                field: "resource ID",
            });
        }
        Ok(Self(value))
    }
}

impl AsRef<str> for ResourceId {
    fn as_ref(&self) -> &str {
        &self.0
    }
}

#[derive(
    utoipa::ToSchema, Clone, Debug, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize,
)]
#[serde(try_from = "String")]
#[schema(min_length = 1, max_length = 256, pattern = "^[A-Za-z0-9_-]+$")]
pub struct GoogleDriveFileId(String);

impl TryFrom<String> for GoogleDriveFileId {
    type Error = InvalidValue;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        if value.is_empty()
            || value.len() > 256
            || !value
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || b"_-".contains(&byte))
        {
            return Err(InvalidValue {
                field: "Google Drive file ID",
            });
        }
        Ok(Self(value))
    }
}

impl AsRef<str> for GoogleDriveFileId {
    fn as_ref(&self) -> &str {
        &self.0
    }
}

#[derive(
    utoipa::ToSchema, Clone, Debug, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize,
)]
#[serde(try_from = "String")]
pub struct GoogleDriveUrl(url::Url);

impl TryFrom<String> for GoogleDriveUrl {
    type Error = InvalidValue;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        url::Url::parse(&value)
            .ok()
            .and_then(|url| google_drive::download_url(&url))
            .map(Self)
            .ok_or(InvalidValue {
                field: "Google Drive file URL",
            })
    }
}

impl GoogleDriveUrl {
    pub fn file_id(&self) -> GoogleDriveFileId {
        GoogleDriveFileId(
            self.0
                .query_pairs()
                .find(|(key, _)| key == "id")
                .unwrap()
                .1
                .into_owned(),
        )
    }
}

impl AsRef<url::Url> for GoogleDriveUrl {
    fn as_ref(&self) -> &url::Url {
        &self.0
    }
}

#[derive(utoipa::ToSchema, Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(try_from = "String")]
#[schema(min_length = 64, max_length = 64, pattern = "^[0-9a-f]{64}$")]
pub struct ContentHash(String);

impl TryFrom<String> for ContentHash {
    type Error = InvalidValue;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        if value.len() != 64
            || !value
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        {
            return Err(InvalidValue {
                field: "SHA-256 digest",
            });
        }
        Ok(Self(value))
    }
}

impl AsRef<str> for ContentHash {
    fn as_ref(&self) -> &str {
        &self.0
    }
}

#[derive(
    utoipa::ToSchema, Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize,
)]
#[serde(try_from = "i32")]
#[schema(minimum = 1, maximum = 9999)]
pub struct AcademicYear(u16);

impl TryFrom<i32> for AcademicYear {
    type Error = InvalidValue;

    fn try_from(value: i32) -> Result<Self, Self::Error> {
        if !(1..=9999).contains(&value) {
            return Err(InvalidValue {
                field: "academic year",
            });
        }
        Ok(Self(value as u16))
    }
}

impl From<AcademicYear> for i64 {
    fn from(value: AcademicYear) -> Self {
        value.0.into()
    }
}

#[derive(utoipa::ToSchema, Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(try_from = "String")]
pub struct WebUrl(url::Url);

impl TryFrom<String> for WebUrl {
    type Error = InvalidValue;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        let url = url::Url::parse(&value).map_err(|_| InvalidValue { field: "URL" })?;
        if !matches!(url.scheme(), "http" | "https")
            || url.host_str().is_none()
            || !url.username().is_empty()
            || url.password().is_some()
        {
            return Err(InvalidValue { field: "HTTP URL" });
        }
        Ok(Self(url))
    }
}

impl AsRef<url::Url> for WebUrl {
    fn as_ref(&self) -> &url::Url {
        &self.0
    }
}

#[derive(utoipa::ToSchema, Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(tag = "availability", rename_all = "kebab-case")]
pub enum Access {
    Available {
        #[serde(rename = "lmsCourseId")]
        id: CourseId,
    },
    Unavailable,
}

#[derive(utoipa::ToSchema, Clone, Copy, Debug, serde::Serialize, serde::Deserialize)]
#[serde(try_from = "u8")]
#[schema(minimum = 1, maximum = 7)]
pub struct Weekday(u8);

impl TryFrom<u8> for Weekday {
    type Error = InvalidValue;

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        if !(1..=7).contains(&value) {
            return Err(InvalidValue { field: "weekday" });
        }
        Ok(Self(value))
    }
}

impl From<Weekday> for i64 {
    fn from(value: Weekday) -> Self {
        value.0.into()
    }
}

#[derive(utoipa::ToSchema, Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum Schedule {
    Scheduled {
        weekday: Weekday,
        #[schema(value_type = u32, minimum = 1)]
        period: std::num::NonZeroU32,
    },
    Other,
    Unknown,
}

#[derive(utoipa::ToSchema, Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Course {
    pub name: String,
    pub academic_year: AcademicYear,
    #[serde(flatten)]
    pub access: Access,
    #[serde(flatten)]
    pub schedule: Schedule,
    #[serde(default)]
    pub archived: bool,
}

impl Course {
    pub fn id(&self) -> Option<&CourseId> {
        match &self.access {
            Access::Available { id } => Some(id),
            Access::Unavailable => None,
        }
    }
}

#[derive(utoipa::ToSchema, Clone, Copy, Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Availability {
    Available,
    Unavailable,
}

#[derive(utoipa::ToSchema, Clone, Copy, Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum DocumentStatus {
    Unviewed,
    Viewed,
    PartiallyViewed,
    Unknown,
}

#[derive(
    utoipa::ToSchema, Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize,
)]
#[serde(rename_all = "kebab-case")]
pub enum ReportStatus {
    Unviewed,
    Unsubmitted,
    Submitted,
    ResubmissionRequired,
    Evaluated,
    Unknown,
}

#[derive(utoipa::ToSchema, Clone, Copy, Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum TestStatus {
    NotStarted,
    InProgress,
    Completed,
    Unknown,
}

#[derive(utoipa::ToSchema, Clone, Copy, Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum QuestionnaireStatus {
    Unanswered,
    Answered,
    Unknown,
}

#[derive(utoipa::ToSchema, Clone, Copy, Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum BoardStatus {
    Unposted,
    Evaluated,
    Unknown,
}

#[derive(utoipa::ToSchema, Clone, Copy, Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum FeedbackStatus {
    Unevaluated,
    Evaluated,
    Unknown,
}

#[derive(utoipa::ToSchema, Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum MaterialKind {
    Material {
        status: DocumentStatus,
        #[serde(rename = "resourceAvailability")]
        resource_availability: Availability,
    },
    Report {
        status: ReportStatus,
    },
    Test {
        status: TestStatus,
    },
    Questionnaire {
        status: QuestionnaireStatus,
    },
    ELearning {
        status: TestStatus,
    },
    Board {
        status: BoardStatus,
    },
    Feedback {
        status: FeedbackStatus,
    },
    Unknown {
        status: Unknown,
    },
}

#[derive(utoipa::ToSchema, Clone, Copy, Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Unknown {
    Unknown,
}

#[derive(utoipa::ToSchema, Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(tag = "publicationDeadlineKind", rename_all = "kebab-case")]
pub enum Deadline {
    At {
        #[serde(rename = "publicationDeadlineAt")]
        at: chrono::DateTime<chrono::Utc>,
    },
    Unlisted,
    Closed,
    Unknown,
}

#[derive(utoipa::ToSchema, Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Material {
    #[serde(rename = "lmsMaterialId")]
    pub id: MaterialId,
    pub name: String,
    #[serde(flatten)]
    pub kind: MaterialKind,
    #[serde(flatten)]
    pub deadline: Deadline,
    pub material_link_available: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub retrieved_at: Option<chrono::DateTime<chrono::Utc>>,
    #[serde(default)]
    pub archived: bool,
}

impl Material {
    pub fn inaccessible(&self) -> bool {
        matches!(self.deadline, Deadline::Closed)
            || matches!(
                self.kind,
                MaterialKind::Material {
                    resource_availability: Availability::Unavailable,
                    ..
                }
            )
    }
}

#[derive(utoipa::ToSchema, Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Folder {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub class_date: Option<chrono::NaiveDate>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description_html: Option<String>,
    pub materials: Vec<Material>,
}

#[derive(utoipa::ToSchema, Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct CourseMaterials {
    #[serde(rename = "lmsCourseId")]
    pub course_id: CourseId,
    pub folders: Vec<Folder>,
}

#[derive(utoipa::ToSchema, Clone, Copy, Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ResourceStatus {
    Unviewed,
    Viewed,
    Unknown,
}

#[derive(utoipa::ToSchema, Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum ResourceContent {
    File {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        url: Option<WebUrl>,
    },
    External {
        url: WebUrl,
    },
    Unknown {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        url: Option<WebUrl>,
    },
}

#[derive(utoipa::ToSchema, Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedFile {
    pub content_hash: ContentHash,
    pub original_filename: String,
    pub original_size: u64,
}

#[derive(utoipa::ToSchema, Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Resource {
    #[serde(rename = "lmsResourceId")]
    pub id: ResourceId,
    pub name: String,
    pub status: ResourceStatus,
    #[serde(flatten)]
    pub content: ResourceContent,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub registered_on: Option<chrono::NaiveDate>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub first_viewed_on: Option<chrono::NaiveDate>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default)]
    pub archived: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub saved_file: Option<SavedFile>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub google_drive_file: Option<GoogleDriveFile>,
}

#[derive(utoipa::ToSchema, Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[schema(example = json!({ "id": "drive_file-123" }))]
pub struct GoogleDriveFile {
    pub id: GoogleDriveFileId,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub saved_file: Option<SavedFile>,
}

#[derive(utoipa::ToSchema, Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GoogleDriveDownload {
    pub file: SavedFile,
    pub download_url: String,
}

#[derive(utoipa::ToSchema, Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(tag = "correctionMode", rename_all = "kebab-case")]
pub enum Correction {
    Unknown,
    NotAllowed,
    Unlimited,
    Limited {
        #[serde(rename = "correctionLimit")]
        limit: u64,
    },
}

#[derive(utoipa::ToSchema, Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(tag = "submissionPeriodKind", rename_all = "kebab-case")]
pub enum SubmissionPeriod {
    At(SubmissionWindow),
    Unlisted,
    Unknown,
}

#[derive(utoipa::ToSchema, Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(try_from = "SubmissionWindowInput")]
pub struct SubmissionWindow {
    #[serde(rename = "submissionStartsAt", skip_serializing_if = "Option::is_none")]
    starts_at: Option<chrono::DateTime<chrono::Utc>>,
    #[serde(rename = "submissionDueAt", skip_serializing_if = "Option::is_none")]
    due_at: Option<chrono::DateTime<chrono::Utc>>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct SubmissionWindowInput {
    submission_starts_at: Option<chrono::DateTime<chrono::Utc>>,
    submission_due_at: Option<chrono::DateTime<chrono::Utc>>,
}

impl SubmissionWindow {
    pub fn starts_at(&self) -> Option<chrono::DateTime<chrono::Utc>> {
        self.starts_at
    }

    pub fn due_at(&self) -> Option<chrono::DateTime<chrono::Utc>> {
        self.due_at
    }

    pub fn new(
        starts_at: Option<chrono::DateTime<chrono::Utc>>,
        due_at: Option<chrono::DateTime<chrono::Utc>>,
    ) -> Result<Self, InvalidValue> {
        if starts_at.is_none() && due_at.is_none()
            || starts_at
                .zip(due_at)
                .is_some_and(|(start, due)| due < start)
        {
            return Err(InvalidValue {
                field: "submission window",
            });
        }
        Ok(Self { starts_at, due_at })
    }
}

impl TryFrom<SubmissionWindowInput> for SubmissionWindow {
    type Error = InvalidValue;
    fn try_from(value: SubmissionWindowInput) -> Result<Self, Self::Error> {
        Self::new(value.submission_starts_at, value.submission_due_at)
    }
}

#[derive(utoipa::ToSchema, Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prompt_html: Option<String>,
    pub status: ReportStatus,
    #[serde(flatten)]
    pub submission: SubmissionPeriod,
    #[serde(flatten)]
    pub correction: Correction,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text_answer_allowed: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_answer_allowed: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_total_file_bytes: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub retrieved_at: Option<chrono::DateTime<chrono::Utc>>,
}

#[derive(utoipa::ToSchema, Clone, Debug, serde::Serialize)]
pub struct Detail {
    pub course: Course,
    pub material: Material,
    pub resources: Vec<Resource>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub report: Option<Report>,
}

pub struct CourseListing {
    pub academic_year: AcademicYear,
    pub entries: Vec<Course>,
}

pub struct Snapshot {
    pub courses: Option<CourseListing>,
    pub materials: Option<CourseMaterials>,
    pub contents: Option<MaterialContents>,
}

pub struct MaterialContents {
    pub material_id: MaterialId,
    pub resources: Option<Vec<Resource>>,
    pub report: Option<Report>,
}

#[derive(utoipa::ToSchema, Clone, Debug, serde::Serialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum Download {
    File {
        file: SavedFile,
        #[serde(rename = "downloadUrl")]
        download_url: String,
    },
    External {
        url: WebUrl,
    },
}

#[derive(
    utoipa::ToSchema, Clone, Copy, Debug, Default, serde::Deserialize, PartialEq, Eq, Hash,
)]
#[schema(
    description = "auto reads saved data or starts synchronization; false reads only; true starts synchronization."
)]
pub enum SyncPolicy {
    #[default]
    #[serde(rename = "auto")]
    Auto,
    #[serde(rename = "true")]
    Always,
    #[serde(rename = "false")]
    Never,
}

#[derive(utoipa::ToSchema, Clone, Copy, Debug, Default, serde::Serialize)]
#[serde(tag = "status", rename_all = "kebab-case")]
pub enum Authentication {
    #[default]
    Unknown,
    Authenticated,
    Unauthenticated,
}

#[derive(Debug, serde::Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Assignment {
    #[serde(rename = "lmsCourseId")]
    pub course_id: CourseId,
    pub folder_name: String,
    pub material: Material,
}

#[derive(Debug, serde::Serialize, utoipa::ToSchema)]
pub struct CourseFailure {
    #[serde(rename = "lmsCourseId")]
    pub course_id: CourseId,
    pub error: crate::error::Public,
}

#[derive(Debug, serde::Serialize, utoipa::ToSchema)]
pub struct Assignments {
    pub assignments: Vec<Assignment>,
    pub failures: Vec<CourseFailure>,
}

#[derive(Debug, serde::Serialize, utoipa::ToSchema)]
pub struct Registration {
    pub registered: bool,
}

#[cfg(test)]
mod tests {
    #[test]
    fn identifiers_are_parsed_before_use() {
        for value in ["", "\n", &"x".repeat(201)] {
            assert!(super::CourseId::try_from(value.to_owned()).is_err());
        }
        assert!(super::CourseId::try_from("2026-course-1".to_owned()).is_ok());
        for value in ["", "1", "MAT", "mat1", "MAT1/", "MAT1\n", "../MAT1"] {
            assert!(
                super::MaterialId::try_from(value.to_owned()).is_err(),
                "{value:?}"
            );
        }
        assert!(super::MaterialId::try_from("MAT123".to_owned()).is_ok());
        for value in ["", "SRS", "srs1", "SRS-1", "SRS1/", "SRS1\n"] {
            assert!(
                super::ResourceId::try_from(value.to_owned()).is_err(),
                "{value:?}"
            );
        }
        assert!(super::ResourceId::try_from("SRS123".to_owned()).is_ok());
        assert!(super::ContentHash::try_from("a".repeat(64)).is_ok());
        for value in [
            "../hash".to_owned(),
            "A".repeat(64),
            "g".repeat(64),
            "0".repeat(63),
        ] {
            assert!(super::ContentHash::try_from(value).is_err());
        }
        for value in [0, -1, 10000] {
            assert!(super::AcademicYear::try_from(value).is_err());
        }
        for value in [1, 9999] {
            assert!(super::AcademicYear::try_from(value).is_ok());
        }
    }

    #[test]
    fn google_drive_identifiers_and_urls_are_validated_independently_of_lms_ids() {
        for value in ["", "../file", "file/id", "id?key", &"a".repeat(257)] {
            assert!(super::GoogleDriveFileId::try_from(value.to_owned()).is_err());
        }
        assert!(super::GoogleDriveFileId::try_from("drive_file-123".to_owned()).is_ok());
        for value in [
            "https://example.com/file/d/drive_file-123/view",
            "https://drive.google.com/drive/folders/folder",
            "http://drive.google.com/file/d/drive_file-123/view",
        ] {
            assert!(super::GoogleDriveUrl::try_from(value.to_owned()).is_err());
        }
        let url = super::GoogleDriveUrl::try_from(
            "https://drive.google.com/file/d/drive_file-123/view?resourcekey=secret".to_owned(),
        )
        .unwrap();
        assert_eq!(url.file_id().as_ref(), "drive_file-123");
        assert!(
            url.as_ref()
                .query_pairs()
                .any(|(key, value)| key == "resourcekey" && value == "secret")
        );
        let alternate = super::GoogleDriveUrl::try_from(
            "https://docs.google.com/document/d/drive_file-123/edit?resourcekey=secret".to_owned(),
        )
        .unwrap();
        assert_eq!(url, alternate);
    }

    #[test]
    fn material_statuses_cannot_cross_material_kinds() {
        let cases = [
            (
                "material",
                vec!["unviewed", "viewed", "partially-viewed", "unknown"],
            ),
            (
                "report",
                vec![
                    "unviewed",
                    "unsubmitted",
                    "submitted",
                    "resubmission-required",
                    "evaluated",
                    "unknown",
                ],
            ),
            (
                "test",
                vec!["not-started", "in-progress", "completed", "unknown"],
            ),
            (
                "e-learning",
                vec!["not-started", "in-progress", "completed", "unknown"],
            ),
            ("questionnaire", vec!["unanswered", "answered", "unknown"]),
            ("board", vec!["unposted", "evaluated", "unknown"]),
            ("feedback", vec!["unevaluated", "evaluated", "unknown"]),
            ("unknown", vec!["unknown"]),
        ];
        let statuses: std::collections::HashSet<_> = cases
            .iter()
            .flat_map(|(_, statuses)| statuses.iter().copied())
            .collect();
        for (kind, allowed) in cases {
            for status in &statuses {
                let parsed = serde_json::from_value::<super::MaterialKind>(
                    serde_json::json!({ "type": kind, "status": status, "resourceAvailability": "available" }),
                );
                assert_eq!(parsed.is_ok(), allowed.contains(status), "{kind} {status}");
                if let Ok(parsed) = parsed {
                    let encoded = serde_json::to_value(parsed).unwrap();
                    assert_eq!(encoded["type"], kind);
                    assert_eq!(encoded["status"], *status);
                }
            }
        }
    }

    #[test]
    fn submission_windows_reject_missing_or_reversed_bounds() {
        let start = chrono::DateTime::from_timestamp(100, 0).unwrap();
        let due = chrono::DateTime::from_timestamp(200, 0).unwrap();
        assert!(super::SubmissionWindow::new(None, None).is_err());
        assert!(super::SubmissionWindow::new(Some(due), Some(start)).is_err());
        for (starts_at, due_at) in [
            (Some(start), None),
            (None, Some(due)),
            (Some(start), Some(start)),
            (Some(start), Some(due)),
        ] {
            let window = super::SubmissionWindow::new(starts_at, due_at).unwrap();
            assert_eq!(window.starts_at(), starts_at);
            assert_eq!(window.due_at(), due_at);
        }
        assert!(serde_json::from_value::<super::SubmissionWindow>(serde_json::json!({})).is_err());
    }

    #[test]
    fn only_http_destinations_are_accepted() {
        for value in [
            "file:///etc/passwd",
            "javascript:alert(1)",
            "https://",
            "https://user:password@example.com/",
        ] {
            assert!(super::WebUrl::try_from(value.to_owned()).is_err());
        }
        for value in ["https://example.com/file", "http://example.com/"] {
            assert!(super::WebUrl::try_from(value.to_owned()).is_ok());
        }
    }
}
