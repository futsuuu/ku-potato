mod session;

use futures_util::StreamExt as _;
use tracing::Instrument as _;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error(transparent)]
    Archive(#[from] crate::archive::Error),
    #[error(transparent)]
    BrowserWorker(#[from] crate::browser_worker::Error),
    #[error(transparent)]
    UserBrowser(#[from] crate::user_browser::Error),
    #[error(transparent)]
    Drive(#[from] crate::drive::Error),
    #[error(transparent)]
    Files(#[from] crate::files::Error),
    #[error("The operation timed out")]
    Timeout,
    #[error("Invalid operation snapshot: {0}")]
    InvalidSnapshot(&'static str),
    #[error("Could not encode the operation result: {0}")]
    Serialization(#[from] serde_json::Error),
    #[error("A background task failed: {0}")]
    Task(#[from] tokio::task::JoinError),
}

impl Error {
    pub fn authentication_provider(&self) -> Option<crate::user_browser::Provider> {
        match self {
            Self::UserBrowser(crate::user_browser::Error::AuthenticationRequired(provider)) => {
                Some(*provider)
            }
            Self::BrowserWorker(crate::browser_worker::Error::AuthenticationRequired) => {
                Some(crate::user_browser::Provider::Lms)
            }
            Self::Drive(crate::drive::Error::Download(google_drive::download::Error::Request(
                google_drive::RequestError::AuthenticationRequired,
            ))) => Some(crate::user_browser::Provider::Google),
            _ => None,
        }
    }
}

#[test]
fn only_authentication_failures_select_a_provider() {
    for provider in [
        crate::user_browser::Provider::Lms,
        crate::user_browser::Provider::Google,
    ] {
        let error = Error::from(crate::user_browser::Error::AuthenticationRequired(provider));
        assert_eq!(error.authentication_provider(), Some(provider));
        let error = match provider {
            crate::user_browser::Provider::Lms => {
                Error::from(crate::browser_worker::Error::AuthenticationRequired)
            }
            crate::user_browser::Provider::Google => Error::from(crate::drive::Error::from(
                google_drive::download::Error::Request(
                    google_drive::RequestError::AuthenticationRequired,
                ),
            )),
        };
        assert_eq!(error.authentication_provider(), Some(provider));
        assert_eq!(
            crate::error::Public::from(&error).reason,
            crate::error::Reason::AuthenticationRequired
        );
    }
    for error in [
        Error::from(crate::drive::Error::from(
            google_drive::download::Error::Request(google_drive::RequestError::AccessDenied),
        )),
        Error::from(crate::archive::Error::Missing),
        Error::from(crate::files::Error::Missing),
        Error::Timeout,
        Error::from(crate::user_browser::Error::AuthenticationStorage {
            message: "Credential storage failed".into(),
        }),
    ] {
        assert_eq!(error.authentication_provider(), None);
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub enum Request {
    Login {
        provider: crate::user_browser::Provider,
        interactive: bool,
    },
    CheckAuthentication(crate::user_browser::Provider),
    RegisterWebAuthnCredential {
        interactive: bool,
    },
    DeleteWebAuthnCredential,
    Courses(crate::model::SyncPolicy),
    Materials {
        course: crate::model::CourseId,
        policy: crate::model::SyncPolicy,
    },
    Assignments {
        courses: Vec<crate::model::CourseId>,
        policy: crate::model::SyncPolicy,
    },
    Detail {
        material: crate::model::MaterialId,
        policy: crate::model::SyncPolicy,
    },
    Download {
        material: crate::model::MaterialId,
        resource: crate::model::ResourceId,
    },
}

impl Request {
    fn allows_interaction(&self) -> bool {
        matches!(
            self,
            Self::Login {
                interactive: true,
                ..
            } | Self::RegisterWebAuthnCredential { interactive: true }
        )
    }

    fn changes_authentication(&self) -> bool {
        matches!(
            self,
            Self::Login { .. }
                | Self::CheckAuthentication(_)
                | Self::RegisterWebAuthnCredential { .. }
                | Self::DeleteWebAuthnCredential
        )
    }

    fn policy(&self) -> crate::model::SyncPolicy {
        match self {
            Self::Courses(policy)
            | Self::Materials { policy, .. }
            | Self::Assignments { policy, .. }
            | Self::Detail { policy, .. } => *policy,
            _ => crate::model::SyncPolicy::Always,
        }
    }

    fn require_synchronization(&mut self) {
        match self {
            Self::Courses(policy)
            | Self::Materials { policy, .. }
            | Self::Assignments { policy, .. }
            | Self::Detail { policy, .. } => *policy = crate::model::SyncPolicy::Always,
            _ => (),
        }
    }
}

struct CourseSynchronization {
    position: usize,
    course: crate::model::CourseId,
    result: Result<crate::model::CourseMaterials, Error>,
}

#[derive(Clone, Debug, serde::Serialize, utoipa::ToSchema)]
#[serde(rename_all = "kebab-case")]
pub enum Stage {
    Waiting,
    Authenticating,
    Registering,
    FetchingCourses,
    FetchingMaterials,
    FetchingResources,
    Downloading,
    Saving,
    Completed,
}

#[derive(Clone, Debug, serde::Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub stage: Stage,
    pub completed: usize,
    pub total: usize,
    #[serde(rename = "lmsCourseId", skip_serializing_if = "Option::is_none")]
    pub course: Option<crate::model::CourseId>,
}

#[derive(Clone, Debug)]
pub enum Update {
    Running(Progress),
    Finished(Result<serde_json::Value, crate::error::Public>),
}

#[derive(Default)]
struct AuthenticationCache {
    lms: crate::model::Authentication,
    google: crate::model::Authentication,
}

pub struct Options {
    pub temporary_directory: std::path::PathBuf,
    pub job_timeout: std::time::Duration,
    pub course_concurrency: std::num::NonZeroUsize,
}

pub struct Coordinator {
    pub archive: crate::archive::Store,
    pub files: crate::files::Store,
    browser_worker: crate::browser_worker::Client,
    pub(crate) user_browser: crate::user_browser::Client,
    options: Options,
    active: tokio::sync::Mutex<
        std::collections::HashMap<Request, tokio::sync::watch::Receiver<Update>>,
    >,
    authentication: tokio::sync::RwLock<AuthenticationCache>,
    authentication_gate: tokio::sync::RwLock<()>,
    session_refresh: tokio::sync::Mutex<()>,
    file_persistence: tokio::sync::Mutex<()>,
    tasks: tokio_util::task::TaskTracker,
    stop: tokio_util::sync::CancellationToken,
}

impl Coordinator {
    pub fn new(
        archive: crate::archive::Store,
        files: crate::files::Store,
        browser_worker: crate::browser_worker::Client,
        user_browser: crate::user_browser::Client,
        options: Options,
    ) -> Self {
        Self {
            archive,
            files,
            browser_worker,
            user_browser,
            options,
            active: Default::default(),
            authentication: Default::default(),
            authentication_gate: Default::default(),
            session_refresh: Default::default(),
            file_persistence: Default::default(),
            tasks: Default::default(),
            stop: Default::default(),
        }
    }

    pub async fn cached_authentication(
        &self,
        provider: crate::user_browser::Provider,
    ) -> crate::model::Authentication {
        let authentication = self.authentication.read().await;
        match provider {
            crate::user_browser::Provider::Lms => authentication.lms,
            crate::user_browser::Provider::Google => authentication.google,
        }
    }

    async fn set_authentication(
        &self,
        provider: crate::user_browser::Provider,
        state: crate::model::Authentication,
    ) {
        let mut authentication = self.authentication.write().await;
        match provider {
            crate::user_browser::Provider::Lms => authentication.lms = state,
            crate::user_browser::Provider::Google => authentication.google = state,
        }
    }
}

#[tokio::test]
async fn cached_authentication_keeps_each_provider_independent() {
    let fixture = crate::rpc::tests::Fixture::new().await;
    let operations = fixture.operations().await;
    for provider in [
        crate::user_browser::Provider::Lms,
        crate::user_browser::Provider::Google,
    ] {
        assert!(matches!(
            operations.cached_authentication(provider).await,
            crate::model::Authentication::Unknown
        ));
    }
    for (provider, other) in [
        (
            crate::user_browser::Provider::Lms,
            crate::user_browser::Provider::Google,
        ),
        (
            crate::user_browser::Provider::Google,
            crate::user_browser::Provider::Lms,
        ),
    ] {
        operations
            .set_authentication(other, crate::model::Authentication::Authenticated)
            .await;
        operations
            .set_authentication(provider, crate::model::Authentication::Unauthenticated)
            .await;
        assert!(matches!(
            operations.cached_authentication(provider).await,
            crate::model::Authentication::Unauthenticated
        ));
        assert!(matches!(
            operations.cached_authentication(other).await,
            crate::model::Authentication::Authenticated
        ));
    }
    operations.shutdown().await;
}

impl Coordinator {
    pub async fn observe_or_start(
        self: &std::sync::Arc<Self>,
        mut request: Request,
    ) -> tokio::sync::watch::Receiver<Update> {
        if let Request::Assignments { courses, .. } = &mut request {
            let mut seen = std::collections::HashSet::new();
            courses.retain(|id| seen.insert(id.clone()));
        }
        if request.policy() != crate::model::SyncPolicy::Always {
            match self.load_from_archive(&request).await {
                Ok(value) => return tokio::sync::watch::channel(Update::Finished(Ok(value))).1,
                Err(Error::Archive(crate::archive::Error::Missing))
                    if request.policy() == crate::model::SyncPolicy::Auto =>
                {
                    request.require_synchronization()
                }
                Err(error) => {
                    if !matches!(error, Error::Archive(crate::archive::Error::Missing)) {
                        tracing::warn!(error = %error, "could not load saved operation result");
                    }
                    return tokio::sync::watch::channel(Update::Finished(Err(
                        crate::error::Public::from(&error),
                    )))
                    .1;
                }
            }
        }
        let mut active = self.active.lock().await;
        if let Some(receiver) = active.get(&request) {
            return receiver.clone();
        }
        let (sender, receiver) = tokio::sync::watch::channel(Update::Running(Progress {
            stage: Stage::Waiting,
            completed: 0,
            total: 0,
            course: None,
        }));
        active.insert(request.clone(), receiver.clone());
        let operations = self.clone();
        self.tasks.spawn(async move {
            let timeout = if request.allows_interaction() { std::time::Duration::from_secs(600) } else { operations.options.job_timeout };
            let result = tokio::select! {
                _ = operations.stop.cancelled() => Err(Error::Timeout),
                result = tokio::time::timeout(timeout, operations.execute_locked(&request, &sender)) => result.unwrap_or(Err(Error::Timeout)),
            };
            if let Err(error) = &result {
                tracing::Span::current().record("otel.status_code", "ERROR");
                tracing::warn!(error = %error, "operation failed");
                if let Some(provider) = error.authentication_provider() {
                    operations.set_authentication(provider, crate::model::Authentication::Unauthenticated).await;
                }
            }
            sender.send_replace(Update::Finished(result.map_err(|error| crate::error::Public::from(&error))));
            operations.active.lock().await.remove(&request);
        }.instrument(tracing::info_span!("operation.execute", otel.status_code = tracing::field::Empty)));
        receiver
    }

    pub async fn shutdown(&self) {
        self.stop.cancel();
        self.tasks.close();
        self.tasks.wait().await;
    }

    async fn save_resource_file(
        self: &std::sync::Arc<Self>,
        retrieval: crate::archive::ResourceRetrieval,
        resource: crate::model::ResourceId,
        source: crate::files::Source,
    ) -> Result<crate::model::SavedFile, Error> {
        let operations = self.clone();
        self.tasks
            .spawn(
                async move {
                    let _guard = operations.file_persistence.lock().await;
                    let file = operations.files.save(source).await?;
                    match operations
                        .archive
                        .replace_saved_file(retrieval, &resource, &file)
                        .await
                    {
                        Ok(previous) => {
                            if let Some(previous) = previous
                                && previous.content_hash != file.content_hash
                            {
                                operations
                                    .remove_unreferenced_content(&previous.content_hash)
                                    .await;
                            }
                            Ok(file)
                        }
                        Err(error) => {
                            operations
                                .remove_unreferenced_content(&file.content_hash)
                                .await;
                            Err(error.into())
                        }
                    }
                }
                .instrument(tracing::info_span!("operation.save_resource_file")),
            )
            .await?
    }
}

#[tokio::test]
async fn file_replacement_removes_only_content_without_remaining_references() {
    let fixture = crate::rpc::tests::Fixture::new().await;
    let operations = fixture.operations().await;
    let retrieval = resource_retrieval(&operations).await;
    let save = |resource: &str, content: &[u8]| {
        operations.save_resource_file(
            retrieval.clone(),
            resource.to_owned().try_into().unwrap(),
            source(content),
        )
    };
    let original = save("SRS1", b"original").await.unwrap();
    let same = save("SRS1", b"original").await.unwrap();
    assert_eq!(original.content_hash, same.content_hash);
    operations
        .files
        .materialize(original.clone())
        .await
        .unwrap();
    save("SRS2", b"original").await.unwrap();
    let updated = save("SRS1", b"updated").await.unwrap();
    assert_ne!(original.content_hash, updated.content_hash);
    operations
        .files
        .materialize(original.clone())
        .await
        .unwrap();
    let (first, second) = tokio::join!(save("SRS1", b"final"), save("SRS2", b"updated"));
    let first = first.unwrap();
    let second = second.unwrap();
    assert!(matches!(
        operations.files.materialize(original.clone()).await,
        Err(crate::files::Error::Missing)
    ));
    assert_eq!(
        std::fs::read(operations.files.materialize(second).await.unwrap()).unwrap(),
        b"updated"
    );
    assert_eq!(
        std::fs::read(operations.files.materialize(first).await.unwrap()).unwrap(),
        b"final"
    );
    assert!(
        !operations
            .archive
            .references_content(&original.content_hash)
            .await
            .unwrap()
    );
    operations.shutdown().await;
}

#[tokio::test]
async fn failed_file_replacements_discard_new_content_but_keep_shared_content() {
    let fixture = crate::rpc::tests::Fixture::new().await;
    let operations = fixture.operations().await;
    let retrieval = resource_retrieval(&operations).await;
    let save = |retrieval: crate::archive::ResourceRetrieval, content: &[u8]| {
        operations.save_resource_file(
            retrieval,
            "SRS1".to_owned().try_into().unwrap(),
            source(content),
        )
    };
    let missing = crate::archive::ResourceRetrieval {
        id: "missing".into(),
        ..retrieval.clone()
    };
    let original = save(retrieval, b"original").await.unwrap();
    assert!(save(missing.clone(), b"orphan").await.is_err());
    assert!(save(missing, b"original").await.is_err());
    let saved = operations
        .archive
        .saved_file(
            &"MAT1".to_owned().try_into().unwrap(),
            &"SRS1".to_owned().try_into().unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(saved.content_hash, original.content_hash);
    assert_eq!(
        std::fs::read(operations.files.materialize(saved).await.unwrap()).unwrap(),
        b"original"
    );
    assert_eq!(
        std::fs::read_dir(fixture.temporary.path().join("resources"))
            .unwrap()
            .count(),
        1
    );
    operations.shutdown().await;
}

#[tokio::test]
async fn file_persistence_finishes_after_its_observer_is_canceled() {
    let fixture = crate::rpc::tests::Fixture::new().await;
    let operations = fixture.operations().await;
    let retrieval = resource_retrieval(&operations).await;
    let material: crate::model::MaterialId = "MAT1".to_owned().try_into().unwrap();
    let resource: crate::model::ResourceId = "SRS1".to_owned().try_into().unwrap();
    let guard = operations.file_persistence.lock().await;
    let mut saving = Box::pin(operations.save_resource_file(
        retrieval.clone(),
        resource.clone(),
        source(b"saved"),
    ));
    assert!(futures_util::poll!(saving.as_mut()).is_pending());
    let mut failing = Box::pin(operations.save_resource_file(
        crate::archive::ResourceRetrieval {
            id: "missing".into(),
            ..retrieval
        },
        resource.clone(),
        source(b"orphan"),
    ));
    assert!(futures_util::poll!(failing.as_mut()).is_pending());
    drop(saving);
    drop(failing);
    drop(guard);
    operations.shutdown().await;
    let saved = operations
        .archive
        .saved_file(&material, &resource)
        .await
        .unwrap();
    assert_eq!(
        std::fs::read(operations.files.materialize(saved).await.unwrap()).unwrap(),
        b"saved"
    );
    assert_eq!(
        std::fs::read_dir(fixture.temporary.path().join("resources"))
            .unwrap()
            .count(),
        1
    );
}

#[cfg(test)]
fn source(content: &[u8]) -> crate::files::Source {
    use std::io::Write as _;
    let mut source = tempfile::NamedTempFile::new().unwrap();
    source.write_all(content).unwrap();
    crate::files::Source {
        temporary_file: source,
        original_filename: "file.txt".into(),
    }
}

#[cfg(test)]
async fn resource_retrieval(operations: &Coordinator) -> crate::archive::ResourceRetrieval {
    let mut snapshot = operations
        .browser_worker
        .fetch_material_contents(&"MAT1".to_owned().try_into().unwrap(), None)
        .await
        .unwrap();
    let resources = snapshot
        .contents
        .as_mut()
        .unwrap()
        .resources
        .as_mut()
        .unwrap();
    let mut second = resources[0].clone();
    second.id = "SRS2".to_owned().try_into().unwrap();
    resources.push(second);
    operations.archive.append(snapshot).await.unwrap().unwrap()
}

impl Coordinator {
    async fn remove_unreferenced_content(&self, hash: &crate::model::ContentHash) {
        let result = async {
            if !self.archive.references_content(hash).await? {
                self.files.remove_content(hash).await?;
            }
            Ok::<_, Error>(())
        }
        .await;
        if let Err(error) = result {
            tracing::warn!(error = %error, content_hash = hash.as_ref(), "could not remove unreferenced content");
        }
    }

    async fn execute_locked(
        self: &std::sync::Arc<Self>,
        request: &Request,
        sender: &tokio::sync::watch::Sender<Update>,
    ) -> Result<serde_json::Value, Error> {
        if request.changes_authentication() {
            let _guard = self.authentication_gate.write().await;
            self.execute(request, sender).await
        } else {
            let _guard = self.authentication_gate.read().await;
            self.execute(request, sender).await
        }
    }

    async fn load_from_archive(&self, request: &Request) -> Result<serde_json::Value, Error> {
        match request {
            Request::Courses(_) => Ok(serde_json::to_value(self.archive.courses().await?)?),
            Request::Materials { course, .. } => Ok(serde_json::to_value(
                self.archive.course_materials(course).await?,
            )?),
            Request::Detail { material, .. } => Ok(serde_json::to_value(
                self.archive.material_detail(material).await?,
            )?),
            Request::Assignments { courses, policy } => {
                let courses = if courses.is_empty() {
                    self.archive
                        .courses()
                        .await?
                        .into_iter()
                        .filter_map(|course| course.id().cloned())
                        .collect()
                } else {
                    courses.clone()
                };
                let mut listings = Vec::new();
                let mut failures = Vec::new();
                let mut seen = std::collections::HashSet::new();
                for course in courses {
                    if !seen.insert(course.clone()) {
                        continue;
                    }
                    match self.archive.course_materials(&course).await {
                        Ok(materials) => listings.push(materials),
                        Err(crate::archive::Error::Missing)
                            if *policy == crate::model::SyncPolicy::Auto =>
                        {
                            return Err(Error::Archive(crate::archive::Error::Missing));
                        }
                        Err(error) => {
                            tracing::warn!(error = %error, course_id = course.as_ref(), "could not read saved course materials");
                            failures.push(crate::model::CourseFailure {
                                course_id: course,
                                error: crate::error::Public::from(&error),
                            });
                        }
                    }
                }
                Ok(serde_json::to_value(collect_assignments(
                    listings, failures,
                ))?)
            }
            _ => Err(Error::Archive(crate::archive::Error::Missing)),
        }
    }

    async fn archive_snapshot(
        &self,
        snapshot: crate::model::Snapshot,
    ) -> Result<Option<crate::archive::ResourceRetrieval>, crate::archive::Error> {
        let retrieval = self.archive.append(snapshot).await?;
        self.set_authentication(
            crate::user_browser::Provider::Lms,
            crate::model::Authentication::Authenticated,
        )
        .await;
        Ok(retrieval)
    }

    async fn synchronize_materials(
        &self,
        course: &crate::model::CourseId,
    ) -> Result<crate::model::CourseMaterials, Error> {
        self.archive_snapshot(
            self.with_lms_session(|| self.browser_worker.fetch_course_materials(course))
                .await?,
        )
        .await?;
        Ok(self.archive.course_materials(course).await?)
    }

    async fn execute(
        self: &std::sync::Arc<Self>,
        request: &Request,
        sender: &tokio::sync::watch::Sender<Update>,
    ) -> Result<serde_json::Value, Error> {
        match request {
            Request::Login {
                provider,
                interactive,
            } => {
                report_stage(sender, Stage::Authenticating);
                self.user_browser.login(*provider, *interactive).await?;
                self.set_authentication(*provider, crate::model::Authentication::Authenticated)
                    .await;
                Ok(serde_json::to_value(
                    crate::model::Authentication::Authenticated,
                )?)
            }
            Request::CheckAuthentication(provider) => {
                report_stage(sender, Stage::Authenticating);
                let state = self.user_browser.authentication_status(*provider).await?;
                self.set_authentication(*provider, state).await;
                Ok(serde_json::to_value(state)?)
            }
            Request::RegisterWebAuthnCredential { interactive } => {
                report_stage(sender, Stage::Registering);
                self.user_browser
                    .register_web_authn_credential(*interactive)
                    .await?;
                self.set_authentication(
                    crate::user_browser::Provider::Lms,
                    crate::model::Authentication::Authenticated,
                )
                .await;
                Ok(serde_json::to_value(crate::model::Registration {
                    registered: true,
                })?)
            }
            Request::DeleteWebAuthnCredential => {
                self.user_browser.delete_web_authn_credential().await?;
                Ok(serde_json::to_value(crate::model::Registration {
                    registered: false,
                })?)
            }
            Request::Courses(_) => {
                report_stage(sender, Stage::FetchingCourses);
                self.archive_snapshot(
                    self.with_lms_session(|| self.browser_worker.fetch_courses())
                        .await?,
                )
                .await?;
                Ok(serde_json::to_value(self.archive.courses().await?)?)
            }
            Request::Materials { course, .. } => {
                report_stage(sender, Stage::FetchingMaterials);
                Ok(serde_json::to_value(
                    self.synchronize_materials(course).await?,
                )?)
            }
            Request::Assignments { courses, .. } => {
                let courses = if courses.is_empty() {
                    report_stage(sender, Stage::FetchingCourses);
                    let snapshot = self
                        .with_lms_session(|| self.browser_worker.fetch_courses())
                        .await?;
                    let courses = snapshot
                        .courses
                        .as_ref()
                        .ok_or(Error::InvalidSnapshot("course listing"))?
                        .entries
                        .iter()
                        .filter_map(|course| course.id().cloned())
                        .collect();
                    self.archive_snapshot(snapshot).await?;
                    courses
                } else {
                    courses.clone()
                };
                let mut seen = std::collections::HashSet::new();
                let courses: Vec<_> = courses
                    .into_iter()
                    .filter(|course| seen.insert(course.clone()))
                    .collect();
                let total = courses.len();
                let mut pending = futures_util::stream::iter(courses.into_iter().enumerate().map(
                    |(position, course)| async move {
                        let result = self.synchronize_materials(&course).await;
                        CourseSynchronization {
                            position,
                            course,
                            result,
                        }
                    },
                ))
                .buffer_unordered(self.options.course_concurrency.get());
                let mut outcomes = Vec::new();
                while let Some(CourseSynchronization {
                    position,
                    course,
                    result,
                }) = pending.next().await
                {
                    let result = match result {
                        Err(error) if error.authentication_provider().is_some() => {
                            return Err(error);
                        }
                        result => result,
                    };
                    sender.send_replace(Update::Running(Progress {
                        stage: Stage::FetchingMaterials,
                        completed: outcomes.len() + 1,
                        total,
                        course: Some(course.clone()),
                    }));
                    outcomes.push(CourseSynchronization {
                        position,
                        course,
                        result,
                    });
                }
                outcomes.sort_by_key(|outcome| outcome.position);
                let mut listings = Vec::new();
                let mut failures = Vec::new();
                for CourseSynchronization { course, result, .. } in outcomes {
                    match result {
                        Ok(materials) => listings.push(materials),
                        Err(error) => {
                            tracing::warn!(error = %error, course_id = course.as_ref(), "could not synchronize course materials");
                            failures.push(crate::model::CourseFailure {
                                course_id: course,
                                error: crate::error::Public::from(&error),
                            });
                        }
                    }
                }
                Ok(serde_json::to_value(collect_assignments(
                    listings, failures,
                ))?)
            }
            Request::Detail { material, .. } => {
                report_stage(sender, Stage::FetchingResources);
                let preferred = self.archive.find_course_for_material(material).await?;
                self.archive_snapshot(
                    self.with_lms_session(|| {
                        self.browser_worker
                            .fetch_material_contents(material, preferred.as_ref())
                    })
                    .await?,
                )
                .await?;
                Ok(serde_json::to_value(
                    self.archive.material_detail(material).await?,
                )?)
            }
            Request::Download { material, resource } => {
                report_stage(sender, Stage::Downloading);
                let preferred = self.archive.find_course_for_material(material).await?;
                let crate::browser_worker::Download { snapshot, outcome } = self
                    .with_lms_session(|| {
                        self.browser_worker.download_resource(
                            material,
                            resource,
                            preferred.as_ref(),
                            &self.options.temporary_directory,
                        )
                    })
                    .await?;
                let retrieval = self.archive_snapshot(snapshot).await?;
                let source = match outcome? {
                    crate::browser_worker::DownloadOutcome::File(source) => source,
                    crate::browser_worker::DownloadOutcome::ExternalUrl(url) => {
                        let Some(destination) = google_drive::download_url(url.as_ref()) else {
                            return Ok(serde_json::to_value(crate::model::Download::External {
                                url,
                            })?);
                        };
                        let cookies = self.user_browser.google_cookies().await?;
                        let client = google_drive::Client::new(std::sync::Arc::new(cookies))
                            .map_err(crate::drive::Error::Client)?;
                        crate::drive::download_file(
                            &client,
                            &destination,
                            &self.options.temporary_directory,
                        )
                        .await?
                    }
                };
                report_stage(sender, Stage::Saving);
                let retrieval =
                    retrieval.ok_or(Error::InvalidSnapshot("file without resource retrieval"))?;
                let file = self
                    .save_resource_file(retrieval, resource.clone(), source)
                    .await?;
                Ok(serde_json::to_value(crate::model::Download::File {
                    file,
                    download_url: format!(
                        "/materials/{}/resources/{}/file",
                        material.as_ref(),
                        resource.as_ref()
                    ),
                })?)
            }
        }
    }
}

#[tokio::test]
async fn google_download_authentication_failure_does_not_invalidate_lms() {
    let fixture = crate::rpc::tests::Fixture::new().await;
    fixture
        .service
        .google_authentication_required
        .store(true, std::sync::atomic::Ordering::SeqCst);
    let operations = fixture.operations().await;
    for provider in [
        crate::user_browser::Provider::Lms,
        crate::user_browser::Provider::Google,
    ] {
        operations
            .set_authentication(provider, crate::model::Authentication::Authenticated)
            .await;
    }
    let mut updates = operations
        .observe_or_start(Request::Download {
            material: "MAT1".to_owned().try_into().unwrap(),
            resource: "SRS1".to_owned().try_into().unwrap(),
        })
        .await;
    updates
        .wait_for(|update| matches!(update, Update::Finished(_)))
        .await
        .unwrap();
    assert!(
        matches!(&*updates.borrow(), Update::Finished(Err(error)) if error.reason == crate::error::Reason::AuthenticationRequired)
    );
    assert!(matches!(
        operations
            .cached_authentication(crate::user_browser::Provider::Lms)
            .await,
        crate::model::Authentication::Authenticated
    ));
    assert!(matches!(
        operations
            .cached_authentication(crate::user_browser::Provider::Google)
            .await,
        crate::model::Authentication::Unauthenticated
    ));
    operations.shutdown().await;
}

fn report_stage(sender: &tokio::sync::watch::Sender<Update>, stage: Stage) {
    sender.send_replace(Update::Running(Progress {
        stage,
        completed: 0,
        total: 0,
        course: None,
    }));
}

fn collect_assignments(
    listings: Vec<crate::model::CourseMaterials>,
    failures: Vec<crate::model::CourseFailure>,
) -> crate::model::Assignments {
    let mut assignments = Vec::new();
    for listing in listings {
        for folder in listing.folders {
            for material in folder.materials {
                if !matches!(material.kind, crate::model::MaterialKind::Material { .. }) {
                    assignments.push(crate::model::Assignment {
                        course_id: listing.course_id.clone(),
                        folder_name: folder.name.clone(),
                        material,
                    });
                }
            }
        }
    }
    crate::model::Assignments {
        assignments,
        failures,
    }
}
