pub mod protocol {
    tonic::include_proto!("kupotato.browserworker.v1");
}
mod decode;

use prost::Message as _;
use tokio::io::AsyncWriteExt as _;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("Authentication is required")]
    AuthenticationRequired,
    #[error("{message}")]
    AuthenticationStorage { message: String },
    #[error("{message}")]
    BrowserStart { message: String },
    #[error("Course {id:?} was not found")]
    CourseNotFound { id: crate::model::CourseId },
    #[error("Material {id:?} was not found")]
    MaterialNotFound { id: crate::model::MaterialId },
    #[error("Resource {id:?} was not found")]
    ResourceNotFound { id: crate::model::ResourceId },
    #[error("Resource {id:?} cannot be downloaded")]
    UnsupportedResource { id: crate::model::ResourceId },
    #[error("{message}")]
    Source { message: String },
    #[error("{message}")]
    Forbidden { message: String },
    #[error("Invalid browser response for {field}: {details}")]
    InvalidResponse {
        field: &'static str,
        details: serde_json::Value,
        #[source]
        source: Option<Box<dyn std::error::Error + Send + Sync>>,
    },
    #[error("Browser worker RPC failed: {source}")]
    Rpc {
        #[source]
        source: Box<tonic::Status>,
    },
    #[error("Could not store downloaded content: {0}")]
    DownloadStorage(#[source] std::io::Error),
}

impl Error {
    fn invalid_response(field: &'static str, details: serde_json::Value) -> Self {
        Self::InvalidResponse {
            field,
            details,
            source: None,
        }
    }
}

impl From<crate::model::InvalidValue> for Error {
    fn from(source: crate::model::InvalidValue) -> Self {
        Self::InvalidResponse {
            field: source.field,
            details: serde_json::Value::Null,
            source: Some(Box::new(source)),
        }
    }
}

#[derive(Clone)]
pub struct Client {
    inner: protocol::browser_worker_client::BrowserWorkerClient<
        tonic::service::interceptor::InterceptedService<
            tonic::transport::Channel,
            crate::rpc::Token,
        >,
    >,
}

pub struct Download {
    pub snapshot: crate::model::Snapshot,
    pub outcome: Result<DownloadOutcome, Error>,
}

pub enum DownloadOutcome {
    File(crate::files::Source),
    ExternalUrl(crate::model::WebUrl),
}

impl Client {
    pub fn new(connection: crate::rpc::Connection) -> Self {
        Self {
            inner: protocol::browser_worker_client::BrowserWorkerClient::with_interceptor(
                connection.channel,
                connection.token,
            ),
        }
    }

    #[tracing::instrument(skip_all)]
    pub async fn set_sso_cookies(&self, cookies: Vec<protocol::Cookie>) -> Result<(), Error> {
        self.inner
            .clone()
            .set_sso_cookies(protocol::SsoCookies { cookies })
            .await
            .map_err(map_status)?;
        Ok(())
    }

    #[tracing::instrument(skip_all)]
    pub async fn fetch_courses(&self) -> Result<crate::model::Snapshot, Error> {
        let listing = self
            .inner
            .clone()
            .courses(())
            .await
            .map_err(map_status)?
            .into_inner();
        Ok(crate::model::Snapshot {
            courses: Some(decode::course_listing(listing)?),
            materials: None,
            contents: None,
        })
    }
}

#[tokio::test]
async fn authentication_failures_do_not_contact_the_credential_service() {
    let fixture = crate::rpc::tests::Fixture::new().await;
    fixture
        .service
        .require_renewal
        .store(true, std::sync::atomic::Ordering::SeqCst);
    assert!(matches!(
        fixture.browser_worker.fetch_courses().await,
        Err(Error::AuthenticationRequired)
    ));
    assert_eq!(
        fixture
            .service
            .courses_calls
            .load(std::sync::atomic::Ordering::SeqCst),
        1
    );
    assert_eq!(
        fixture
            .service
            .cookie_calls
            .load(std::sync::atomic::Ordering::SeqCst),
        0
    );
}

impl Client {
    #[tracing::instrument(skip_all)]
    pub async fn fetch_course_materials(
        &self,
        course: &crate::model::CourseId,
    ) -> Result<crate::model::Snapshot, Error> {
        let snapshot = self
            .inner
            .clone()
            .materials(protocol::MaterialsRequest {
                course_id: Some(protocol::CourseId {
                    value: course.as_ref().to_owned(),
                }),
            })
            .await
            .map_err(map_status)?
            .into_inner();
        let snapshot = decode::snapshot(snapshot)?;
        if snapshot
            .materials
            .as_ref()
            .map(|materials| &materials.course_id)
            != Some(course)
        {
            return Err(Error::invalid_response(
                "course ID",
                serde_json::json!({
                    "expected": course,
                    "actual": snapshot.materials.as_ref().map(|materials| &materials.course_id),
                }),
            ));
        }
        Ok(snapshot)
    }

    #[tracing::instrument(skip_all)]
    pub async fn fetch_material_contents(
        &self,
        material: &crate::model::MaterialId,
        preferred_course_id: Option<&crate::model::CourseId>,
    ) -> Result<crate::model::Snapshot, Error> {
        let snapshot = self
            .inner
            .clone()
            .resources(protocol::ResourcesRequest {
                material_id: Some(protocol::MaterialId {
                    value: material.as_ref().to_owned(),
                }),
                preferred_course_id: preferred_course_id.map(|id| protocol::CourseId {
                    value: id.as_ref().to_owned(),
                }),
            })
            .await
            .map_err(map_status)?
            .into_inner();
        let snapshot = decode::snapshot(snapshot)?;
        if snapshot
            .contents
            .as_ref()
            .map(|contents| &contents.material_id)
            != Some(material)
        {
            return Err(Error::invalid_response(
                "material ID",
                serde_json::json!({
                    "expected": material,
                    "actual": snapshot.contents.as_ref().map(|contents| &contents.material_id),
                }),
            ));
        }
        Ok(snapshot)
    }
}

#[tokio::test]
async fn mismatched_responses_preserve_requested_and_received_identifiers() {
    let fixture = crate::rpc::tests::Fixture::new().await;
    assert!(matches!(
        fixture.browser_worker.fetch_course_materials(&"other".to_owned().try_into().unwrap()).await,
        Err(Error::InvalidResponse { field: "course ID", details, .. })
            if details == serde_json::json!({ "expected": "other", "actual": "course1" })
    ));
    assert!(matches!(
        fixture.browser_worker.fetch_material_contents(&"MAT2".to_owned().try_into().unwrap(), None).await,
        Err(Error::InvalidResponse { field: "material ID", details, .. })
            if details == serde_json::json!({ "expected": "MAT2", "actual": "MAT1" })
    ));
}

impl Client {
    #[tracing::instrument(skip_all)]
    pub async fn download_resource(
        &self,
        material: &crate::model::MaterialId,
        resource: &crate::model::ResourceId,
        preferred_course_id: Option<&crate::model::CourseId>,
        temporary: &std::path::Path,
    ) -> Result<Download, Error> {
        let mut stream = self
            .inner
            .clone()
            .download(protocol::DownloadRequest {
                material_id: Some(protocol::MaterialId {
                    value: material.as_ref().to_owned(),
                }),
                resource_id: Some(protocol::ResourceId {
                    value: resource.as_ref().to_owned(),
                }),
                preferred_course_id: preferred_course_id.map(|id| protocol::CourseId {
                    value: id.as_ref().to_owned(),
                }),
            })
            .await
            .map_err(map_status)?
            .into_inner();
        let header = match stream
            .message()
            .await
            .map_err(map_status)?
            .and_then(|part| part.part)
        {
            Some(protocol::download_part::Part::Header(header)) => header,
            Some(protocol::download_part::Part::Chunk(chunk)) => {
                return Err(Error::invalid_response(
                    "download header",
                    serde_json::json!({ "chunkSize": chunk.len() }),
                ));
            }
            None => {
                return Err(Error::invalid_response(
                    "download header",
                    serde_json::Value::Null,
                ));
            }
        };
        let snapshot = decode::snapshot(header.snapshot.ok_or_else(|| {
            Error::invalid_response("download snapshot", serde_json::Value::Null)
        })?)?;
        if snapshot
            .contents
            .as_ref()
            .map(|contents| &contents.material_id)
            != Some(material)
        {
            return Err(Error::invalid_response(
                "material ID",
                serde_json::json!({
                    "expected": material,
                    "actual": snapshot.contents.as_ref().map(|contents| &contents.material_id),
                }),
            ));
        }
        let outcome = match header.outcome {
            Some(protocol::download_header::Outcome::Failure(failure)) => {
                let error = decode::failure(failure);
                if matches!(
                    error,
                    Error::AuthenticationRequired | Error::InvalidResponse { .. }
                ) {
                    return Err(error);
                }
                Err(error)
            }
            Some(protocol::download_header::Outcome::ExternalUrl(url)) => {
                Ok(DownloadOutcome::ExternalUrl(url.try_into()?))
            }
            Some(protocol::download_header::Outcome::File(metadata)) => {
                Self::receive_file(stream, metadata, temporary)
                    .await
                    .map(DownloadOutcome::File)
            }
            None => {
                return Err(Error::invalid_response(
                    "download outcome",
                    serde_json::Value::Null,
                ));
            }
        };
        Ok(Download { snapshot, outcome })
    }

    async fn receive_file(
        mut stream: tonic::Streaming<protocol::DownloadPart>,
        metadata: protocol::FileDownload,
        temporary: &std::path::Path,
    ) -> Result<crate::files::Source, Error> {
        let expected = u64::try_from(metadata.byte_size).map_err(|_| {
            Error::invalid_response(
                "download size",
                serde_json::json!({ "value": metadata.byte_size }),
            )
        })?;
        if metadata.filename.is_empty() {
            return Err(Error::invalid_response(
                "download filename",
                serde_json::json!(""),
            ));
        }
        let file = tempfile::NamedTempFile::new_in(temporary).map_err(Error::DownloadStorage)?;
        let mut output = tokio::fs::File::from_std(file.reopen().map_err(Error::DownloadStorage)?);
        let mut received = 0_u64;
        while let Some(part) = stream.message().await.map_err(map_status)? {
            let chunk = match part.part {
                Some(protocol::download_part::Part::Chunk(chunk)) => chunk,
                Some(protocol::download_part::Part::Header(_)) => {
                    return Err(Error::invalid_response(
                        "download chunk",
                        serde_json::json!({ "part": "header" }),
                    ));
                }
                None => {
                    return Err(Error::invalid_response(
                        "download chunk",
                        serde_json::Value::Null,
                    ));
                }
            };
            received = received.checked_add(chunk.len() as u64).ok_or_else(|| {
                Error::invalid_response(
                    "download size",
                    serde_json::json!({ "received": received, "chunkSize": chunk.len() }),
                )
            })?;
            if received > expected {
                return Err(Error::invalid_response(
                    "download size",
                    serde_json::json!({ "expected": expected, "received": received }),
                ));
            }
            output
                .write_all(&chunk)
                .await
                .map_err(Error::DownloadStorage)?;
        }
        if received != expected {
            return Err(Error::invalid_response(
                "download size",
                serde_json::json!({ "expected": expected, "received": received }),
            ));
        }
        output.sync_all().await.map_err(Error::DownloadStorage)?;
        Ok(crate::files::Source {
            temporary_file: file,
            original_filename: metadata.filename,
        })
    }
}

#[tokio::test]
async fn downloads_require_exact_declared_length_and_clean_temporary_files() {
    let fixture = crate::rpc::tests::Fixture::new().await;
    fixture
        .service
        .truncated
        .store(true, std::sync::atomic::Ordering::SeqCst);
    assert!(matches!(
        fixture
            .browser_worker
            .download_resource(
                &"MAT1".to_owned().try_into().unwrap(),
                &"SRS1".to_owned().try_into().unwrap(),
                None,
                fixture.temporary.path(),
            )
            .await
            .unwrap()
            .outcome,
        Err(Error::InvalidResponse { field: "download size", details, .. })
            if details == serde_json::json!({ "expected": 5, "received": 0 })
    ));
    assert_eq!(
        std::fs::read_dir(fixture.temporary.path()).unwrap().count(),
        0
    );
    fixture
        .service
        .truncated
        .store(false, std::sync::atomic::Ordering::SeqCst);
    let download = fixture
        .browser_worker
        .download_resource(
            &"MAT1".to_owned().try_into().unwrap(),
            &"SRS1".to_owned().try_into().unwrap(),
            None,
            fixture.temporary.path(),
        )
        .await
        .unwrap();
    let DownloadOutcome::File(source) = download.outcome.unwrap() else {
        panic!("expected file");
    };
    assert_eq!(
        std::fs::read(source.temporary_file.path()).unwrap(),
        b"hello"
    );
}

#[tokio::test]
async fn download_storage_failures_preserve_the_io_error() {
    let fixture = crate::rpc::tests::Fixture::new().await;
    let temporary = fixture.temporary.path().join("missing");
    let result = fixture
        .browser_worker
        .download_resource(
            &"MAT1".to_owned().try_into().unwrap(),
            &"SRS1".to_owned().try_into().unwrap(),
            None,
            &temporary,
        )
        .await
        .unwrap();
    assert!(matches!(
        result.outcome,
        Err(Error::DownloadStorage(source)) if source.kind() == std::io::ErrorKind::NotFound
    ));
}

fn map_status(status: tonic::Status) -> Error {
    if status.code() != tonic::Code::DeadlineExceeded
        && let Ok(details) = crate::rpc::Status::decode(status.details())
    {
        for detail in details.details {
            if detail.type_url == "type.googleapis.com/kupotato.browserworker.v1.Failure"
                && let Ok(failure) = protocol::Failure::decode(detail.value.as_slice())
            {
                return decode::failure(failure);
            }
        }
    }
    Error::Rpc {
        source: status.into(),
    }
}

#[test]
fn browser_worker_failures_preserve_target_identifiers() {
    for failure in [
        protocol::Failure {
            reason: protocol::FailureReason::CourseNotFound.into(),
            message: "Missing course".into(),
            target: Some(protocol::failure::Target::CourseId(protocol::CourseId {
                value: "missing-course".into(),
            })),
        },
        protocol::Failure {
            reason: protocol::FailureReason::MaterialNotFound.into(),
            message: "Missing material".into(),
            target: Some(protocol::failure::Target::MaterialId(
                protocol::MaterialId {
                    value: "MAT2".into(),
                },
            )),
        },
        protocol::Failure {
            reason: protocol::FailureReason::ResourceNotFound.into(),
            message: "Missing resource".into(),
            target: Some(protocol::failure::Target::ResourceId(
                protocol::ResourceId {
                    value: "SRS2".into(),
                },
            )),
        },
        protocol::Failure {
            reason: protocol::FailureReason::UnsupportedResource.into(),
            message: "Unsupported resource".into(),
            target: Some(protocol::failure::Target::ResourceId(
                protocol::ResourceId {
                    value: "SRS2".into(),
                },
            )),
        },
    ] {
        let reason = protocol::FailureReason::try_from(failure.reason).unwrap();
        let details = crate::rpc::Status {
            code: tonic::Code::FailedPrecondition as i32,
            message: failure.message.clone(),
            details: vec![prost_types::Any {
                type_url: "type.googleapis.com/kupotato.browserworker.v1.Failure".into(),
                value: failure.encode_to_vec(),
            }],
        };
        let error = map_status(tonic::Status::with_details(
            tonic::Code::FailedPrecondition,
            failure.message,
            details.encode_to_vec().into(),
        ));
        match &error {
            Error::CourseNotFound { id } => assert_eq!(id.as_ref(), "missing-course"),
            Error::MaterialNotFound { id } => assert_eq!(id.as_ref(), "MAT2"),
            Error::ResourceNotFound { id } | Error::UnsupportedResource { id } => {
                assert_eq!(id.as_ref(), "SRS2")
            }
            error => panic!("unexpected error: {error:?}"),
        }
        let public = crate::error::Public::from(&error);
        assert_eq!(
            serde_json::to_value(public.reason).unwrap(),
            reason
                .as_str_name()
                .strip_prefix("FAILURE_REASON_")
                .unwrap()
                .to_ascii_lowercase()
                .replace('_', "-"),
        );
    }
}

#[test]
fn request_timeouts_preserve_the_rpc_status() {
    let error = map_status(tonic::Status::deadline_exceeded("Worker deadline"));
    assert!(matches!(&error, Error::Rpc { source }
        if source.code() == tonic::Code::DeadlineExceeded && source.message() == "Worker deadline"));
    let public = crate::error::Public::from(&error);
    assert_eq!(public.reason, crate::error::Reason::Timeout);
    assert_eq!(public.message, "The browser request timed out");
}
