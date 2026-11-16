pub mod protocol {
    pub mod browser_worker {
        tonic::include_proto!("kupotato.browser.v1");
    }
    pub mod user_browser {
        tonic::include_proto!("kupotato.userbrowser.v1");
    }
}
mod decode;
pub mod drive;
pub mod process;

use prost::Message as _;
use tokio::io::AsyncWriteExt as _;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("Authentication is required for {0:?}")]
    AuthenticationRequired(Provider),
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
    #[error("{message}")]
    Conflict { message: String },
    #[error("Invalid browser response for {field}: {details}")]
    InvalidResponse {
        field: &'static str,
        details: serde_json::Value,
        #[source]
        source: Option<Box<dyn std::error::Error + Send + Sync>>,
    },
    #[error(transparent)]
    Drive(#[from] google_drive::Error),
    #[error("{service:?} RPC failed: {source}")]
    Rpc {
        service: process::Service,
        #[source]
        source: Box<tonic::Status>,
    },
    #[error("Could not download the Google Drive file: {0}")]
    DriveRequest(#[source] reqwest::Error),
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
pub struct Token {
    header: tonic::metadata::MetadataKey<tonic::metadata::Ascii>,
    value: tonic::metadata::MetadataValue<tonic::metadata::Ascii>,
}

impl Token {
    pub fn new(
        header: &'static str,
        value: &str,
    ) -> Result<Self, tonic::metadata::errors::InvalidMetadataValue> {
        Ok(Self {
            header: tonic::metadata::MetadataKey::from_static(header),
            value: value.parse()?,
        })
    }
}

impl tonic::service::Interceptor for Token {
    fn call(
        &mut self,
        mut request: tonic::Request<()>,
    ) -> Result<tonic::Request<()>, tonic::Status> {
        request
            .metadata_mut()
            .insert(self.header.clone(), self.value.clone());
        Ok(request)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Provider {
    Lms,
    Google,
}

impl Provider {
    fn wire(self) -> i32 {
        match self {
            Self::Lms => protocol::user_browser::Provider::Lms.into(),
            Self::Google => protocol::user_browser::Provider::Google.into(),
        }
    }
}

#[derive(Clone)]
pub struct Connection {
    pub channel: tonic::transport::Channel,
    pub token: Token,
}

#[derive(Clone)]
pub struct Client {
    browser_worker: protocol::browser_worker::browser_worker_client::BrowserWorkerClient<
        tonic::service::interceptor::InterceptedService<tonic::transport::Channel, Token>,
    >,
    user_browser: protocol::user_browser::user_browser_client::UserBrowserClient<
        tonic::service::interceptor::InterceptedService<tonic::transport::Channel, Token>,
    >,
    refresh: std::sync::Arc<tokio::sync::Mutex<()>>,
    temporary: std::path::PathBuf,
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
    pub fn new(
        browser_worker: Connection,
        user_browser: Connection,
        temporary: std::path::PathBuf,
    ) -> Self {
        Self {
            browser_worker: protocol::browser_worker::browser_worker_client::BrowserWorkerClient::with_interceptor(
                browser_worker.channel,
                browser_worker.token,
            ),
            user_browser: protocol::user_browser::user_browser_client::UserBrowserClient::with_interceptor(
                user_browser.channel,
                user_browser.token,
            ),
            refresh: Default::default(),
            temporary,
        }
    }

    pub async fn login(&self, provider: Provider, interactive: bool) -> Result<(), Error> {
        self.user_browser
            .clone()
            .login(protocol::user_browser::LoginRequest {
                provider: provider.wire(),
                interactive,
            })
            .await
            .map_err(|status| user_browser_error(status, provider))?;
        Ok(())
    }

    pub async fn authentication_status(
        &self,
        provider: Provider,
    ) -> Result<crate::model::Authentication, Error> {
        let response = self
            .user_browser
            .clone()
            .status(protocol::user_browser::ProviderRequest {
                provider: provider.wire(),
            })
            .await
            .map_err(|status| user_browser_error(status, provider))?
            .into_inner();
        Ok(if response.authenticated {
            crate::model::Authentication::Authenticated
        } else {
            crate::model::Authentication::Unauthenticated
        })
    }

    pub async fn is_web_authn_credential_registered(&self) -> Result<bool, Error> {
        Ok(self
            .user_browser
            .clone()
            .web_authn_registration_status(())
            .await
            .map_err(|status| user_browser_error(status, Provider::Lms))?
            .into_inner()
            .registered)
    }

    pub async fn register_web_authn_credential(&self, interactive: bool) -> Result<(), Error> {
        self.user_browser
            .clone()
            .register_web_authn(protocol::user_browser::InteractiveRequest { interactive })
            .await
            .map_err(|status| user_browser_error(status, Provider::Lms))?;
        Ok(())
    }

    pub async fn delete_web_authn_credential(&self) -> Result<(), Error> {
        self.user_browser
            .clone()
            .delete_web_authn(())
            .await
            .map_err(|status| user_browser_error(status, Provider::Lms))?;
        Ok(())
    }

    async fn refresh_lms_session(&self, renew: bool) -> Result<(), Error> {
        let _guard = self.refresh.lock().await;
        let cookies = self
            .user_browser
            .clone()
            .sso_cookies(protocol::user_browser::SsoCookiesRequest { renew })
            .await
            .map_err(|status| user_browser_error(status, Provider::Lms))?
            .into_inner()
            .cookies;
        let cookies = cookies
            .into_iter()
            .map(decode::cookie)
            .collect::<Result<Vec<_>, _>>()?;
        self.browser_worker
            .clone()
            .set_sso_cookies(protocol::browser_worker::SsoCookies { cookies })
            .await
            .map_err(browser_worker_error)?;
        Ok(())
    }

    async fn with_lms_session<T, F, Fut>(&self, mut run: F) -> Result<T, Error>
    where
        F: FnMut() -> Fut,
        Fut: std::future::Future<Output = Result<T, Error>>,
    {
        for attempt in 0..3 {
            match run().await {
                Err(error)
                    if matches!(error, Error::AuthenticationRequired(Provider::Lms))
                        && attempt < 2 =>
                {
                    self.refresh_lms_session(attempt == 1).await?
                }
                result => return result,
            }
        }
        Err(Error::AuthenticationRequired(Provider::Lms))
    }

    pub async fn fetch_courses(&self) -> Result<crate::model::Snapshot, Error> {
        self.with_lms_session(|| async {
            let listing = self
                .browser_worker
                .clone()
                .courses(())
                .await
                .map_err(browser_worker_error)?
                .into_inner();
            Ok(crate::model::Snapshot {
                courses: Some(decode::course_listing(listing)?),
                materials: None,
                contents: None,
            })
        })
        .await
    }

    pub async fn fetch_course_materials(
        &self,
        course: &crate::model::CourseId,
    ) -> Result<crate::model::Snapshot, Error> {
        self.with_lms_session(|| async {
            let snapshot = self
                .browser_worker
                .clone()
                .materials(protocol::browser_worker::MaterialsRequest {
                    course_id: Some(protocol::browser_worker::CourseId {
                        value: course.as_ref().to_owned(),
                    }),
                })
                .await
                .map_err(browser_worker_error)?
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
        })
        .await
    }

    pub async fn fetch_material_contents(
        &self,
        material: &crate::model::MaterialId,
        preferred_course_id: Option<&crate::model::CourseId>,
    ) -> Result<crate::model::Snapshot, Error> {
        self.with_lms_session(|| async {
            let snapshot = self
                .browser_worker
                .clone()
                .resources(protocol::browser_worker::ResourcesRequest {
                    material_id: Some(protocol::browser_worker::MaterialId {
                        value: material.as_ref().to_owned(),
                    }),
                    preferred_course_id: preferred_course_id.map(|id| {
                        protocol::browser_worker::CourseId {
                            value: id.as_ref().to_owned(),
                        }
                    }),
                })
                .await
                .map_err(browser_worker_error)?
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
        })
        .await
    }

    pub async fn download_resource(
        &self,
        material: &crate::model::MaterialId,
        resource: &crate::model::ResourceId,
        preferred_course_id: Option<&crate::model::CourseId>,
    ) -> Result<Download, Error> {
        self.with_lms_session(|| async {
            let mut stream = self
                .browser_worker
                .clone()
                .download(protocol::browser_worker::DownloadRequest {
                    material_id: Some(protocol::browser_worker::MaterialId {
                        value: material.as_ref().to_owned(),
                    }),
                    resource_id: Some(protocol::browser_worker::ResourceId {
                        value: resource.as_ref().to_owned(),
                    }),
                    preferred_course_id: preferred_course_id.map(|id| {
                        protocol::browser_worker::CourseId {
                            value: id.as_ref().to_owned(),
                        }
                    }),
                })
                .await
                .map_err(browser_worker_error)?
                .into_inner();
            let header = match stream
                .message()
                .await
                .map_err(browser_worker_error)?
                .and_then(|part| part.part)
            {
                Some(protocol::browser_worker::download_part::Part::Header(header)) => header,
                Some(protocol::browser_worker::download_part::Part::Chunk(chunk)) => {
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
                Some(protocol::browser_worker::download_header::Outcome::Failure(failure)) => {
                    let error = decode::failure(failure);
                    if matches!(
                        error,
                        Error::AuthenticationRequired(_) | Error::InvalidResponse { .. }
                    ) {
                        return Err(error);
                    }
                    Err(error)
                }
                Some(protocol::browser_worker::download_header::Outcome::ExternalUrl(url)) => {
                    Ok(DownloadOutcome::ExternalUrl(url.try_into()?))
                }
                Some(protocol::browser_worker::download_header::Outcome::File(metadata)) => self
                    .receive_file(stream, metadata)
                    .await
                    .map(DownloadOutcome::File),
                None => {
                    return Err(Error::invalid_response(
                        "download outcome",
                        serde_json::Value::Null,
                    ));
                }
            };
            Ok(Download { snapshot, outcome })
        })
        .await
    }

    async fn receive_file(
        &self,
        mut stream: tonic::Streaming<protocol::browser_worker::DownloadPart>,
        metadata: protocol::browser_worker::FileDownload,
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
        let file =
            tempfile::NamedTempFile::new_in(&self.temporary).map_err(Error::DownloadStorage)?;
        let mut output = tokio::fs::File::from_std(file.reopen().map_err(Error::DownloadStorage)?);
        let mut received = 0_u64;
        while let Some(part) = stream.message().await.map_err(browser_worker_error)? {
            let chunk = match part.part {
                Some(protocol::browser_worker::download_part::Part::Chunk(chunk)) => chunk,
                Some(protocol::browser_worker::download_part::Part::Header(_)) => {
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

    pub async fn google_cookies(&self) -> Result<Vec<protocol::user_browser::Cookie>, Error> {
        Ok(self
            .user_browser
            .clone()
            .google_cookies(())
            .await
            .map_err(|status| user_browser_error(status, Provider::Google))?
            .into_inner()
            .cookies)
    }
}

#[derive(Clone, PartialEq, prost::Message)]
struct RpcStatus {
    #[prost(int32, tag = "1")]
    code: i32,
    #[prost(string, tag = "2")]
    message: String,
    #[prost(message, repeated, tag = "3")]
    details: Vec<prost_types::Any>,
}

fn browser_worker_error(status: tonic::Status) -> Error {
    if status.code() != tonic::Code::DeadlineExceeded
        && let Ok(details) = RpcStatus::decode(status.details())
    {
        for detail in details.details {
            if detail.type_url == "type.googleapis.com/kupotato.browser.v1.Failure"
                && let Ok(failure) =
                    protocol::browser_worker::Failure::decode(detail.value.as_slice())
            {
                return decode::failure(failure);
            }
        }
    }
    Error::Rpc {
        service: process::Service::BrowserWorker,
        source: status.into(),
    }
}

fn user_browser_error(status: tonic::Status, provider: Provider) -> Error {
    if status.code() != tonic::Code::DeadlineExceeded
        && let Ok(details) = RpcStatus::decode(status.details())
    {
        for detail in details.details {
            if detail.type_url == "type.googleapis.com/kupotato.userbrowser.v1.Failure"
                && let Ok(failure) =
                    protocol::user_browser::Failure::decode(detail.value.as_slice())
            {
                return match protocol::user_browser::FailureReason::try_from(failure.reason) {
                    Ok(protocol::user_browser::FailureReason::AuthenticationRequired) => {
                        Error::AuthenticationRequired(provider)
                    }
                    Ok(protocol::user_browser::FailureReason::AuthenticationStorage) => {
                        Error::AuthenticationStorage {
                            message: failure.message,
                        }
                    }
                    Ok(protocol::user_browser::FailureReason::BrowserStart) => {
                        Error::BrowserStart {
                            message: failure.message,
                        }
                    }
                    Ok(protocol::user_browser::FailureReason::Source) => Error::Source {
                        message: failure.message,
                    },
                    Ok(protocol::user_browser::FailureReason::Conflict) => Error::Conflict {
                        message: failure.message,
                    },
                    _ => Error::invalid_response(
                        "failure",
                        serde_json::json!({
                            "service": "user-browser",
                            "reason": failure.reason,
                            "message": failure.message,
                        }),
                    ),
                };
            }
        }
    }
    Error::Rpc {
        service: process::Service::UserBrowser,
        source: status.into(),
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use prost::Message as _;

    #[derive(Default)]
    pub(crate) struct Service {
        pub courses_calls: std::sync::atomic::AtomicUsize,
        pub cookie_calls: std::sync::atomic::AtomicUsize,
        pub require_renewal: std::sync::atomic::AtomicBool,
        pub renewed: std::sync::atomic::AtomicBool,
        pub truncated: std::sync::atomic::AtomicBool,
        pub google_authentication_required: std::sync::atomic::AtomicBool,
    }

    pub(crate) struct Fixture {
        pub service: std::sync::Arc<Service>,
        pub client: super::Client,
        pub temporary: tempfile::TempDir,
        stop: tokio_util::sync::CancellationToken,
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            self.stop.cancel();
        }
    }

    impl Fixture {
        pub async fn new() -> Self {
            let service = std::sync::Arc::new(Service::default());
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let endpoint = listener.local_addr().unwrap();
            let stop = tokio_util::sync::CancellationToken::new();
            let serving = tonic::transport::Server::builder()
                .add_service(
                    super::protocol::browser_worker::browser_worker_server::BrowserWorkerServer::from_arc(
                        service.clone(),
                    ),
                )
                .add_service(
                    super::protocol::user_browser::user_browser_server::UserBrowserServer::from_arc(
                        service.clone(),
                    ),
                )
                .serve_with_incoming_shutdown(
                    tokio_stream::wrappers::TcpListenerStream::new(listener),
                    stop.clone().cancelled_owned(),
                );
            tokio::spawn(serving);
            let channel = tonic::transport::Endpoint::from_shared(format!("http://{endpoint}"))
                .unwrap()
                .connect()
                .await
                .unwrap();
            let temporary = tempfile::tempdir().unwrap();
            let client = super::Client::new(
                super::Connection {
                    channel: channel.clone(),
                    token: super::Token::new("x-ku-potato-worker-token", "worker-secret").unwrap(),
                },
                super::Connection {
                    channel,
                    token: super::Token::new("x-ku-potato-user-browser-token", "user-secret")
                        .unwrap(),
                },
                temporary.path().to_path_buf(),
            );
            Self {
                service,
                client,
                temporary,
                stop,
            }
        }

        pub async fn operations(&self) -> std::sync::Arc<crate::operation::Coordinator> {
            std::sync::Arc::new(crate::operation::Coordinator::new(
                crate::archive::Store::open("sqlite::memory:")
                    .await
                    .unwrap(),
                crate::files::Store::new(
                    self.temporary.path().join("resources"),
                    self.temporary.path(),
                )
                .unwrap(),
                self.client.clone(),
                crate::operation::Options {
                    temporary_directory: self.temporary.path().to_path_buf(),
                    job_timeout: std::time::Duration::from_secs(2),
                    course_concurrency: std::num::NonZeroUsize::new(4).unwrap(),
                },
            ))
        }
    }

    pub(crate) fn listing() -> super::protocol::browser_worker::CourseListing {
        super::protocol::browser_worker::CourseListing {
            academic_year: 2026,
            courses: vec![super::protocol::browser_worker::Course {
                name: "Course".into(),
                access: Some(super::protocol::browser_worker::course::Access::Available(
                    super::protocol::browser_worker::CourseId {
                        value: "course1".into(),
                    },
                )),
                schedule: Some(
                    super::protocol::browser_worker::course::Schedule::Scheduled(
                        super::protocol::browser_worker::Schedule {
                            weekday: 1,
                            period: 2,
                        },
                    ),
                ),
            }],
        }
    }

    pub(crate) fn snapshot() -> super::protocol::browser_worker::Snapshot {
        super::protocol::browser_worker::Snapshot {
            academic_year: 2026,
            courses: listing().courses,
            course_materials: Some(super::protocol::browser_worker::CourseMaterials {
                course_id: Some(super::protocol::browser_worker::CourseId {
                    value: "course1".into(),
                }),
                folders: vec![super::protocol::browser_worker::Folder {
                    name: "Week 1".into(),
                    materials: vec![super::protocol::browser_worker::Material {
                        id: Some(super::protocol::browser_worker::MaterialId {
                            value: "MAT1".into(),
                        }),
                        name: "Material".into(),
                        publication_deadline: Some(super::protocol::browser_worker::PublicationDeadline {
                            value: Some(
                                super::protocol::browser_worker::publication_deadline::Value::Unlisted(()),
                            ),
                        }),
                        material_link_available: true,
                        kind: Some(super::protocol::browser_worker::material::Kind::Document(
                            super::protocol::browser_worker::DocumentMaterial {
                                status: super::protocol::browser_worker::DocumentStatus::Unviewed.into(),
                                resource_availability:
                                    super::protocol::browser_worker::LinkAvailability::Available.into(),
                            },
                        )),
                    }],
                    ..Default::default()
                }],
            }),
            material_id: Some(super::protocol::browser_worker::MaterialId {
                value: "MAT1".into(),
            }),
            resource_list: Some(super::protocol::browser_worker::ResourceList {
                resources: vec![super::protocol::browser_worker::Resource {
                    id: Some(super::protocol::browser_worker::ResourceId {
                        value: "SRS1".into(),
                    }),
                    name: "File".into(),
                    status: super::protocol::browser_worker::ResourceStatus::Viewed.into(),
                    content: Some(super::protocol::browser_worker::resource::Content::File(
                        super::protocol::browser_worker::ResourceFile {
                            url: "https://example.com/download".into(),
                        },
                    )),
                    ..Default::default()
                }],
            }),
            report: None,
        }
    }

    fn check<T>(
        request: &tonic::Request<T>,
        header: &'static str,
        secret: &str,
    ) -> Result<(), tonic::Status> {
        if request
            .metadata()
            .get(header)
            .is_none_or(|value| value != secret)
        {
            return Err(tonic::Status::unauthenticated("Missing process token"));
        }
        Ok(())
    }

    fn authentication_required() -> tonic::Status {
        let failure = super::protocol::browser_worker::Failure {
            reason: super::protocol::browser_worker::FailureReason::AuthenticationRequired.into(),
            message: "Login required".into(),
            target: None,
        };
        let status = super::RpcStatus {
            code: tonic::Code::FailedPrecondition as i32,
            message: "Login required".into(),
            details: vec![prost_types::Any {
                type_url: "type.googleapis.com/kupotato.browser.v1.Failure".into(),
                value: failure.encode_to_vec(),
            }],
        };
        tonic::Status::with_details(
            tonic::Code::FailedPrecondition,
            "Login required",
            status.encode_to_vec().into(),
        )
    }

    #[tonic::async_trait]
    impl super::protocol::browser_worker::browser_worker_server::BrowserWorker for Service {
        async fn courses(
            &self,
            request: tonic::Request<()>,
        ) -> Result<tonic::Response<super::protocol::browser_worker::CourseListing>, tonic::Status>
        {
            check(&request, "x-ku-potato-worker-token", "worker-secret")?;
            self.courses_calls
                .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
            if self
                .require_renewal
                .load(std::sync::atomic::Ordering::SeqCst)
                && !self.renewed.load(std::sync::atomic::Ordering::SeqCst)
            {
                return Err(authentication_required());
            }
            Ok(tonic::Response::new(listing()))
        }

        async fn materials(
            &self,
            request: tonic::Request<super::protocol::browser_worker::MaterialsRequest>,
        ) -> Result<tonic::Response<super::protocol::browser_worker::Snapshot>, tonic::Status>
        {
            check(&request, "x-ku-potato-worker-token", "worker-secret")?;
            let mut value = snapshot();
            value.material_id = None;
            value.resource_list = None;
            Ok(tonic::Response::new(value))
        }

        async fn resources(
            &self,
            request: tonic::Request<super::protocol::browser_worker::ResourcesRequest>,
        ) -> Result<tonic::Response<super::protocol::browser_worker::Snapshot>, tonic::Status>
        {
            check(&request, "x-ku-potato-worker-token", "worker-secret")?;
            Ok(tonic::Response::new(snapshot()))
        }

        type DownloadStream = tokio_stream::Iter<
            std::vec::IntoIter<
                Result<super::protocol::browser_worker::DownloadPart, tonic::Status>,
            >,
        >;

        async fn download(
            &self,
            request: tonic::Request<super::protocol::browser_worker::DownloadRequest>,
        ) -> Result<tonic::Response<Self::DownloadStream>, tonic::Status> {
            check(&request, "x-ku-potato-worker-token", "worker-secret")?;
            if self
                .google_authentication_required
                .load(std::sync::atomic::Ordering::SeqCst)
            {
                return Ok(tonic::Response::new(tokio_stream::iter(vec![Ok(
                    super::protocol::browser_worker::DownloadPart {
                        part: Some(super::protocol::browser_worker::download_part::Part::Header(
                            super::protocol::browser_worker::DownloadHeader {
                                snapshot: Some(snapshot()),
                                outcome: Some(
                                    super::protocol::browser_worker::download_header::Outcome::ExternalUrl(
                                        "https://drive.google.com/file/d/example/view".into(),
                                    ),
                                ),
                            },
                        )),
                    },
                )])));
            }
            let mut parts = vec![Ok(super::protocol::browser_worker::DownloadPart {
                part: Some(
                    super::protocol::browser_worker::download_part::Part::Header(
                        super::protocol::browser_worker::DownloadHeader {
                            snapshot: Some(snapshot()),
                            outcome: Some(
                                super::protocol::browser_worker::download_header::Outcome::File(
                                    super::protocol::browser_worker::FileDownload {
                                        filename: "file.txt".into(),
                                        byte_size: 5,
                                    },
                                ),
                            ),
                        },
                    ),
                ),
            })];
            if !self.truncated.load(std::sync::atomic::Ordering::SeqCst) {
                parts.push(Ok(super::protocol::browser_worker::DownloadPart {
                    part: Some(super::protocol::browser_worker::download_part::Part::Chunk(
                        b"hello".to_vec(),
                    )),
                }));
            }
            Ok(tonic::Response::new(tokio_stream::iter(parts)))
        }

        async fn set_sso_cookies(
            &self,
            request: tonic::Request<super::protocol::browser_worker::SsoCookies>,
        ) -> Result<tonic::Response<()>, tonic::Status> {
            check(&request, "x-ku-potato-worker-token", "worker-secret")?;
            self.renewed.store(
                request
                    .into_inner()
                    .cookies
                    .iter()
                    .any(|cookie| cookie.value == "renewed"),
                std::sync::atomic::Ordering::SeqCst,
            );
            Ok(tonic::Response::new(()))
        }
    }

    #[tonic::async_trait]
    impl super::protocol::user_browser::user_browser_server::UserBrowser for Service {
        async fn login(
            &self,
            request: tonic::Request<super::protocol::user_browser::LoginRequest>,
        ) -> Result<tonic::Response<()>, tonic::Status> {
            check(&request, "x-ku-potato-user-browser-token", "user-secret")?;
            Ok(tonic::Response::new(()))
        }

        async fn status(
            &self,
            _: tonic::Request<super::protocol::user_browser::ProviderRequest>,
        ) -> Result<
            tonic::Response<super::protocol::user_browser::AuthenticationStatus>,
            tonic::Status,
        > {
            Ok(tonic::Response::new(
                super::protocol::user_browser::AuthenticationStatus {
                    authenticated: true,
                },
            ))
        }

        async fn register_web_authn(
            &self,
            _: tonic::Request<super::protocol::user_browser::InteractiveRequest>,
        ) -> Result<tonic::Response<()>, tonic::Status> {
            Ok(tonic::Response::new(()))
        }
        async fn web_authn_registration_status(
            &self,
            _: tonic::Request<()>,
        ) -> Result<tonic::Response<super::protocol::user_browser::RegistrationStatus>, tonic::Status>
        {
            Ok(tonic::Response::new(
                super::protocol::user_browser::RegistrationStatus { registered: true },
            ))
        }
        async fn delete_web_authn(
            &self,
            _: tonic::Request<()>,
        ) -> Result<tonic::Response<()>, tonic::Status> {
            Ok(tonic::Response::new(()))
        }
        async fn sso_cookies(
            &self,
            request: tonic::Request<super::protocol::user_browser::SsoCookiesRequest>,
        ) -> Result<tonic::Response<super::protocol::user_browser::Cookies>, tonic::Status>
        {
            check(&request, "x-ku-potato-user-browser-token", "user-secret")?;
            self.cookie_calls
                .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            Ok(tonic::Response::new(
                super::protocol::user_browser::Cookies {
                    cookies: vec![super::protocol::user_browser::Cookie {
                        name: "session".into(),
                        value: if request.into_inner().renew {
                            "renewed"
                        } else {
                            "stale"
                        }
                        .into(),
                        ..Default::default()
                    }],
                },
            ))
        }
        async fn google_cookies(
            &self,
            _: tonic::Request<()>,
        ) -> Result<tonic::Response<super::protocol::user_browser::Cookies>, tonic::Status>
        {
            if self
                .google_authentication_required
                .load(std::sync::atomic::Ordering::SeqCst)
            {
                let failure = super::protocol::user_browser::Failure {
                    reason: super::protocol::user_browser::FailureReason::AuthenticationRequired
                        .into(),
                    message: "Google login required".into(),
                };
                let status = super::RpcStatus {
                    code: tonic::Code::FailedPrecondition as i32,
                    message: failure.message.clone(),
                    details: vec![prost_types::Any {
                        type_url: "type.googleapis.com/kupotato.userbrowser.v1.Failure".into(),
                        value: failure.encode_to_vec(),
                    }],
                };
                return Err(tonic::Status::with_details(
                    tonic::Code::FailedPrecondition,
                    "Google login required",
                    status.encode_to_vec().into(),
                ));
            }
            Ok(tonic::Response::new(
                super::protocol::user_browser::Cookies::default(),
            ))
        }
    }

    #[tokio::test]
    async fn google_cookie_failures_preserve_the_authentication_provider() {
        let fixture = Fixture::new().await;
        assert!(fixture.client.google_cookies().await.unwrap().is_empty());
        fixture
            .service
            .google_authentication_required
            .store(true, std::sync::atomic::Ordering::SeqCst);
        assert!(matches!(
            fixture.client.google_cookies().await,
            Err(super::Error::AuthenticationRequired(
                super::Provider::Google
            ))
        ));
    }

    #[tokio::test]
    async fn authentication_retries_forward_typed_cookies_and_renew_once() {
        let fixture = Fixture::new().await;
        fixture
            .service
            .require_renewal
            .store(true, std::sync::atomic::Ordering::SeqCst);
        fixture.client.fetch_courses().await.unwrap();
        assert_eq!(
            fixture
                .service
                .courses_calls
                .load(std::sync::atomic::Ordering::SeqCst),
            3
        );
        assert_eq!(
            fixture
                .service
                .cookie_calls
                .load(std::sync::atomic::Ordering::SeqCst),
            2
        );
    }

    #[tokio::test]
    async fn downloads_require_exact_declared_length_and_clean_temporary_files() {
        let fixture = Fixture::new().await;
        fixture
            .service
            .truncated
            .store(true, std::sync::atomic::Ordering::SeqCst);
        assert!(matches!(
            fixture
                .client
                .download_resource(
                    &"MAT1".to_owned().try_into().unwrap(),
                    &"SRS1".to_owned().try_into().unwrap(),
                    None,
                )
                .await
                .unwrap()
                .outcome,
            Err(super::Error::InvalidResponse { field: "download size", details, .. })
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
            .client
            .download_resource(
                &"MAT1".to_owned().try_into().unwrap(),
                &"SRS1".to_owned().try_into().unwrap(),
                None,
            )
            .await
            .unwrap();
        let super::DownloadOutcome::File(source) = download.outcome.unwrap() else {
            panic!("expected file");
        };
        assert_eq!(
            std::fs::read(source.temporary_file.path()).unwrap(),
            b"hello"
        );
    }

    #[test]
    fn rpc_authentication_requires_typed_details_and_preserves_the_provider() {
        let failure = super::protocol::user_browser::Failure {
            reason: super::protocol::user_browser::FailureReason::AuthenticationRequired.into(),
            message: "Login required".into(),
        };
        let details = super::RpcStatus {
            code: tonic::Code::FailedPrecondition as i32,
            message: failure.message.clone(),
            details: vec![prost_types::Any {
                type_url: "type.googleapis.com/kupotato.userbrowser.v1.Failure".into(),
                value: failure.encode_to_vec(),
            }],
        }
        .encode_to_vec();
        for provider in [super::Provider::Lms, super::Provider::Google] {
            let status = tonic::Status::with_details(
                tonic::Code::FailedPrecondition,
                "Login required",
                details.clone().into(),
            );
            assert!(matches!(
                super::user_browser_error(status, provider),
                super::Error::AuthenticationRequired(actual) if actual == provider
            ));
            assert!(matches!(
                super::user_browser_error(
                    tonic::Status::unauthenticated("Login required"),
                    provider
                ),
                super::Error::Rpc { .. }
            ));
        }
    }

    #[test]
    fn browser_worker_failures_reject_unknown_reasons() {
        for reason in [0, 999] {
            assert!(matches!(
                super::decode::failure(super::protocol::browser_worker::Failure {
                    reason,
                    message: "Failure".into(),
                    target: None,
                }),
                super::Error::InvalidResponse { field: "failure", details, .. }
                    if details == serde_json::json!({
                        "service": "browser-worker",
                        "reason": reason,
                        "message": "Failure",
                        "target": null,
                    })
            ));
        }
        assert!(matches!(
            super::decode::failure(super::protocol::browser_worker::Failure {
                reason: super::protocol::browser_worker::FailureReason::AuthenticationRequired
                    .into(),
                message: "Login required".into(),
                target: None,
            }),
            super::Error::AuthenticationRequired(super::Provider::Lms)
        ));
    }

    #[test]
    fn browser_worker_failures_preserve_public_reasons_and_messages() {
        for reason in [
            super::protocol::browser_worker::FailureReason::AuthenticationStorage,
            super::protocol::browser_worker::FailureReason::BrowserStart,
            super::protocol::browser_worker::FailureReason::Source,
            super::protocol::browser_worker::FailureReason::Forbidden,
        ] {
            let error = super::decode::failure(super::protocol::browser_worker::Failure {
                reason: reason.into(),
                message: "Browser worker rejected the request".into(),
                target: None,
            });
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
            assert_eq!(public.message, "Browser worker rejected the request");
        }
    }

    #[test]
    fn browser_worker_failures_preserve_target_identifiers() {
        for failure in [
            super::protocol::browser_worker::Failure {
                reason: super::protocol::browser_worker::FailureReason::CourseNotFound.into(),
                message: "Missing course".into(),
                target: Some(super::protocol::browser_worker::failure::Target::CourseId(
                    super::protocol::browser_worker::CourseId {
                        value: "missing-course".into(),
                    },
                )),
            },
            super::protocol::browser_worker::Failure {
                reason: super::protocol::browser_worker::FailureReason::MaterialNotFound.into(),
                message: "Missing material".into(),
                target: Some(
                    super::protocol::browser_worker::failure::Target::MaterialId(
                        super::protocol::browser_worker::MaterialId {
                            value: "MAT2".into(),
                        },
                    ),
                ),
            },
            super::protocol::browser_worker::Failure {
                reason: super::protocol::browser_worker::FailureReason::ResourceNotFound.into(),
                message: "Missing resource".into(),
                target: Some(
                    super::protocol::browser_worker::failure::Target::ResourceId(
                        super::protocol::browser_worker::ResourceId {
                            value: "SRS2".into(),
                        },
                    ),
                ),
            },
            super::protocol::browser_worker::Failure {
                reason: super::protocol::browser_worker::FailureReason::UnsupportedResource.into(),
                message: "Unsupported resource".into(),
                target: Some(
                    super::protocol::browser_worker::failure::Target::ResourceId(
                        super::protocol::browser_worker::ResourceId {
                            value: "SRS2".into(),
                        },
                    ),
                ),
            },
        ] {
            let reason =
                super::protocol::browser_worker::FailureReason::try_from(failure.reason).unwrap();
            let details = super::RpcStatus {
                code: tonic::Code::FailedPrecondition as i32,
                message: failure.message.clone(),
                details: vec![prost_types::Any {
                    type_url: "type.googleapis.com/kupotato.browser.v1.Failure".into(),
                    value: failure.encode_to_vec(),
                }],
            };
            let error = super::browser_worker_error(tonic::Status::with_details(
                tonic::Code::FailedPrecondition,
                failure.message,
                details.encode_to_vec().into(),
            ));
            match &error {
                super::Error::CourseNotFound { id } => assert_eq!(id.as_ref(), "missing-course"),
                super::Error::MaterialNotFound { id } => assert_eq!(id.as_ref(), "MAT2"),
                super::Error::ResourceNotFound { id }
                | super::Error::UnsupportedResource { id } => assert_eq!(id.as_ref(), "SRS2"),
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
    fn browser_worker_failures_require_valid_matching_targets() {
        for reason in [
            super::protocol::browser_worker::FailureReason::CourseNotFound,
            super::protocol::browser_worker::FailureReason::MaterialNotFound,
            super::protocol::browser_worker::FailureReason::ResourceNotFound,
            super::protocol::browser_worker::FailureReason::UnsupportedResource,
        ] {
            for target in [
                None,
                Some(super::protocol::browser_worker::failure::Target::CourseId(
                    super::protocol::browser_worker::CourseId {
                        value: String::new(),
                    },
                )),
                Some(
                    super::protocol::browser_worker::failure::Target::MaterialId(
                        super::protocol::browser_worker::MaterialId {
                            value: "invalid".into(),
                        },
                    ),
                ),
                Some(
                    super::protocol::browser_worker::failure::Target::ResourceId(
                        super::protocol::browser_worker::ResourceId {
                            value: "invalid".into(),
                        },
                    ),
                ),
            ] {
                let error = super::decode::failure(super::protocol::browser_worker::Failure {
                    reason: reason.into(),
                    message: "Missing target".into(),
                    target,
                });
                assert!(matches!(error, super::Error::InvalidResponse { .. }));
                assert_eq!(
                    crate::error::Public::from(&error).reason,
                    crate::error::Reason::Source
                );
            }
        }
        assert!(matches!(
            super::decode::failure(super::protocol::browser_worker::Failure {
                reason: super::protocol::browser_worker::FailureReason::CourseNotFound.into(),
                message: "Wrong target".into(),
                target: Some(super::protocol::browser_worker::failure::Target::MaterialId(
                    super::protocol::browser_worker::MaterialId { value: "MAT2".into() },
                )),
            }),
            super::Error::InvalidResponse { field: "failure", details, .. }
                if details["target"] == serde_json::json!({ "materialId": "MAT2" })
        ));
    }

    #[test]
    fn user_browser_failures_preserve_public_reasons_and_messages() {
        for reason in [
            super::protocol::user_browser::FailureReason::AuthenticationStorage,
            super::protocol::user_browser::FailureReason::BrowserStart,
            super::protocol::user_browser::FailureReason::Source,
            super::protocol::user_browser::FailureReason::Conflict,
        ] {
            let failure = super::protocol::user_browser::Failure {
                reason: reason.into(),
                message: "User browser rejected the request".into(),
            };
            let details = super::RpcStatus {
                code: tonic::Code::FailedPrecondition as i32,
                message: failure.message.clone(),
                details: vec![prost_types::Any {
                    type_url: "type.googleapis.com/kupotato.userbrowser.v1.Failure".into(),
                    value: failure.encode_to_vec(),
                }],
            }
            .encode_to_vec();
            let error = super::user_browser_error(
                tonic::Status::with_details(
                    tonic::Code::FailedPrecondition,
                    failure.message,
                    details.into(),
                ),
                super::Provider::Lms,
            );
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
            assert_eq!(public.message, "User browser rejected the request");
        }
    }

    #[tokio::test]
    async fn download_storage_failures_preserve_the_io_error() {
        let fixture = Fixture::new().await;
        let mut client = fixture.client.clone();
        client.temporary = fixture.temporary.path().join("missing");
        let result = client
            .download_resource(
                &"MAT1".to_owned().try_into().unwrap(),
                &"SRS1".to_owned().try_into().unwrap(),
                None,
            )
            .await
            .unwrap();
        assert!(matches!(
            result.outcome,
            Err(super::Error::DownloadStorage(source)) if source.kind() == std::io::ErrorKind::NotFound
        ));
    }

    #[tokio::test]
    async fn mismatched_responses_preserve_requested_and_received_identifiers() {
        let fixture = Fixture::new().await;
        assert!(matches!(
            fixture.client.fetch_course_materials(&"other".to_owned().try_into().unwrap()).await,
            Err(super::Error::InvalidResponse { field: "course ID", details, .. })
                if details == serde_json::json!({ "expected": "other", "actual": "course1" })
        ));
        assert!(matches!(
            fixture.client.fetch_material_contents(&"MAT2".to_owned().try_into().unwrap(), None).await,
            Err(super::Error::InvalidResponse { field: "material ID", details, .. })
                if details == serde_json::json!({ "expected": "MAT2", "actual": "MAT1" })
        ));
    }

    #[test]
    fn request_timeouts_preserve_the_service_and_rpc_status() {
        let worker =
            super::browser_worker_error(tonic::Status::deadline_exceeded("Worker deadline"));
        let user = super::user_browser_error(
            tonic::Status::deadline_exceeded("User browser deadline"),
            super::Provider::Google,
        );
        assert!(matches!(&worker, super::Error::Rpc {
            service: super::process::Service::BrowserWorker, source,
        } if source.message() == "Worker deadline"));
        assert!(matches!(&user, super::Error::Rpc {
            service: super::process::Service::UserBrowser, source,
        } if source.message() == "User browser deadline"));
        for error in [worker, user] {
            assert_eq!(
                std::error::Error::source(&error)
                    .unwrap()
                    .downcast_ref::<Box<tonic::Status>>()
                    .unwrap()
                    .code(),
                tonic::Code::DeadlineExceeded,
            );
            let public = crate::error::Public::from(&error);
            assert_eq!(public.reason, crate::error::Reason::Timeout);
            assert_eq!(public.message, "The browser request timed out");
        }
    }

    #[test]
    fn duplicate_responses_preserve_the_conflicting_identifier() {
        let mut value = snapshot();
        let folder = &mut value.course_materials.as_mut().unwrap().folders[0];
        folder.materials.push(folder.materials[0].clone());
        assert!(matches!(
            super::decode::snapshot(value),
            Err(super::Error::InvalidResponse { field: "material ID", details, .. })
                if details == serde_json::json!({ "duplicate": "MAT1" })
        ));
        let mut value = snapshot();
        let resources = &mut value.resource_list.as_mut().unwrap().resources;
        resources.push(resources[0].clone());
        assert!(matches!(
            super::decode::snapshot(value),
            Err(super::Error::InvalidResponse { field: "resource ID", details, .. })
                if details == serde_json::json!({ "duplicate": "SRS1" })
        ));
    }

    #[test]
    fn malformed_wire_values_preserve_the_invalid_data() {
        let mut value = snapshot();
        value.academic_year = 10000;
        assert!(matches!(
            super::decode::snapshot(value),
            Err(super::Error::InvalidResponse { field: "academic year", details, .. })
                if details == serde_json::json!({ "value": 10000 })
        ));
        let mut value = snapshot();
        value.resource_list.as_mut().unwrap().resources[0].status = 999;
        assert!(matches!(
            super::decode::snapshot(value),
            Err(super::Error::InvalidResponse { field, details, .. })
                if field == std::any::type_name::<super::protocol::browser_worker::ResourceStatus>()
                && details == serde_json::json!({ "value": 999 })
        ));
        let mut value = snapshot();
        value.resource_list.as_mut().unwrap().resources[0].registered_on =
            Some(super::protocol::browser_worker::CalendarDate {
                year: 2026,
                month: 2,
                day: 30,
            });
        assert!(matches!(
            super::decode::snapshot(value),
            Err(super::Error::InvalidResponse { field: "calendar date", details, .. })
                if details == serde_json::json!({ "year": 2026, "month": 2, "day": 30 })
        ));
        let mut value = snapshot();
        value.material_id = None;
        assert!(matches!(
            super::decode::snapshot(value),
            Err(super::Error::InvalidResponse {
                field: "contents material ID",
                details: serde_json::Value::Null,
                ..
            })
        ));
        for timestamp in [
            prost_types::Timestamp {
                seconds: 0,
                nanos: -1,
            },
            prost_types::Timestamp {
                seconds: 253402300800,
                nanos: 0,
            },
        ] {
            assert!(matches!(
                super::decode::timestamp(timestamp),
                Err(super::Error::InvalidResponse { field: "timestamp", details, .. })
                    if details == serde_json::json!({ "seconds": timestamp.seconds, "nanos": timestamp.nanos })
            ));
        }
        assert!(matches!(
            super::decode::cookie(super::protocol::user_browser::Cookie {
                same_site: 999,
                ..Default::default()
            }),
            Err(super::Error::InvalidResponse { field: "cookie same site", details, .. })
                if details == serde_json::json!({ "value": 999 })
        ));
    }
}
