pub mod error;

use axum::response::IntoResponse as _;
use tower::ServiceExt as _;

#[derive(Debug, thiserror::Error)]
enum Error {
    #[error("{0}")]
    InvalidInput(String),
    #[error(transparent)]
    InvalidValue(#[from] crate::model::InvalidValue),
    #[error("Request body exceeds the size limit")]
    BodyTooLarge,
    #[error("Only local clients are accepted")]
    Forbidden,
    #[error("API endpoint not found")]
    NotFound,
    #[error("Could not read the saved WebAuthn credential state: {0}")]
    WebAuthnState(#[source] crate::user_browser::Error),
    #[error(transparent)]
    Archive(#[from] crate::archive::Error),
    #[error(transparent)]
    Files(#[from] crate::files::Error),
    #[error("Could not build a response header: {0}")]
    Header(#[from] axum::http::header::InvalidHeaderValue),
}

impl axum::response::IntoResponse for Error {
    fn into_response(self) -> axum::response::Response {
        let public = error::Details::from(&self);
        let status = public.reason.status_code();
        if status.is_server_error() {
            tracing::error!(error = %self, "HTTP operation failed");
        }
        (status, axum::Json(ErrorBody { error: public })).into_response()
    }
}

impl From<axum::extract::rejection::JsonRejection> for Error {
    fn from(error: axum::extract::rejection::JsonRejection) -> Self {
        if error.status() == axum::http::StatusCode::PAYLOAD_TOO_LARGE {
            Self::BodyTooLarge
        } else {
            Self::InvalidInput(error.body_text())
        }
    }
}

#[derive(Clone)]
struct State {
    operations: std::sync::Arc<crate::operation::Coordinator>,
    authority: std::net::SocketAddr,
}

#[derive(serde::Serialize, utoipa::ToSchema)]
pub struct Data<T> {
    pub data: T,
}

#[derive(serde::Serialize, utoipa::ToSchema)]
pub struct ErrorBody {
    pub error: error::Details,
}

#[derive(serde::Serialize, utoipa::ToSchema)]
pub struct OperationErrorBody {
    pub error: crate::error::Public,
}

#[derive(serde::Serialize, utoipa::ToSchema)]
#[serde(rename_all = "kebab-case")]
pub enum OperationState {
    Running,
    Succeeded,
    Blocked,
    Cancelled,
    Failed,
}

#[derive(serde::Serialize, utoipa::ToSchema)]
pub struct OperationStatus {
    pub status: OperationState,
    #[schema(value_type = u32, minimum = 1)]
    pub attempt: std::num::NonZeroU32,
    pub progress: crate::operation::Progress,
}

#[derive(serde::Serialize, utoipa::ToSchema)]
#[serde(tag = "event", content = "data", rename_all = "kebab-case")]
pub enum StreamEvent<T> {
    Status(OperationStatus),
    Result(Data<T>),
    Error(OperationErrorBody),
}

impl<T: serde::Serialize> StreamEvent<T> {
    fn into_sse(self) -> Result<axum::response::sse::Event, axum::Error> {
        let event = axum::response::sse::Event::default();
        match self {
            Self::Status(status) => event.event("status").json_data(status),
            Self::Result(result) => event.event("result").json_data(result),
            Self::Error(error) => event.event("error").json_data(error),
        }
    }
}

#[derive(serde::Serialize, utoipa::ToSchema)]
struct Health {
    status: &'static str,
    service: &'static str,
}

#[derive(serde::Serialize, utoipa::ToSchema)]
struct ResourcePath {
    #[schema(value_type = String)]
    path: std::path::PathBuf,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ResourceIdentifiers {
    material_id: crate::model::MaterialId,
    resource_id: crate::model::ResourceId,
}

#[derive(serde::Deserialize, utoipa::ToSchema)]
#[serde(deny_unknown_fields)]
#[schema(example = json!({ "url": "https://drive.google.com/file/d/drive_file-123/view" }))]
struct GoogleDriveDownloadInput {
    url: crate::model::GoogleDriveUrl,
}

struct Binary;

impl utoipa::PartialSchema for Binary {
    fn schema() -> utoipa::openapi::RefOr<utoipa::openapi::schema::Schema> {
        utoipa::openapi::ObjectBuilder::new()
            .schema_type(utoipa::openapi::schema::Type::String)
            .format(Some(utoipa::openapi::schema::SchemaFormat::KnownFormat(
                utoipa::openapi::schema::KnownFormat::Binary,
            )))
            .into()
    }
}

impl utoipa::ToSchema for Binary {}

#[derive(Default, serde::Deserialize, utoipa::ToSchema)]
#[serde(default, deny_unknown_fields)]
#[schema(
    description = "Set interactive to allow manual authentication in a visible browser on the server machine."
)]
struct AuthenticationInput {
    interactive: bool,
}

#[derive(Default, serde::Deserialize, utoipa::IntoParams)]
#[serde(default, deny_unknown_fields)]
#[into_params(parameter_in = Query)]
struct Synchronization {
    #[param(inline)]
    sync: crate::model::SyncPolicy,
}

const STREAM_DESCRIPTION: &str = "Valid requests return HTTP 200 with SSE status events followed by exactly one result or error event, then close. Operation outcomes do not change the HTTP status: authentication-required is blocked, cancelled is cancelled, and other errors are failed. HTTP errors describe request rejection before streaming. Disconnecting detaches observation; execution continues. Repeat the request to observe equivalent active work.";

#[derive(utoipa::OpenApi)]
#[openapi(info(
    title = "KU-POTATO HTTP API",
    description = "Single-account loopback API. Feature endpoints stream typed results, operation status, and progress using SSE. Replay the feature request to retry."
))]
struct Documentation;

fn routes() -> utoipa_axum::router::OpenApiRouter<State> {
    utoipa_axum::router::OpenApiRouter::with_openapi(<Documentation as utoipa::OpenApi>::openapi())
        .routes(utoipa_axum::routes!(health))
        .routes(utoipa_axum::routes!(cached_kogakuin_sso))
        .routes(utoipa_axum::routes!(cached_google))
        .routes(utoipa_axum::routes!(login))
        .routes(utoipa_axum::routes!(check))
        .routes(utoipa_axum::routes!(google_login))
        .routes(utoipa_axum::routes!(google_check))
        .routes(utoipa_axum::routes!(
            registration,
            register,
            delete_registration
        ))
        .routes(utoipa_axum::routes!(courses))
        .routes(utoipa_axum::routes!(materials))
        .routes(utoipa_axum::routes!(assignments))
        .routes(utoipa_axum::routes!(detail))
        .routes(utoipa_axum::routes!(download))
        .routes(utoipa_axum::routes!(prepare))
        .routes(utoipa_axum::routes!(file, head_file))
        .routes(utoipa_axum::routes!(google_drive_download))
        .routes(utoipa_axum::routes!(google_drive_prepare))
        .routes(utoipa_axum::routes!(
            google_drive_file,
            google_drive_head_file
        ))
        .routes(utoipa_axum::routes!(specification))
}

pub fn openapi() -> utoipa::openapi::OpenApi {
    routes().into_openapi()
}

pub fn router(
    operations: std::sync::Arc<crate::operation::Coordinator>,
    authority: std::net::SocketAddr,
) -> axum::Router {
    let state = State {
        operations,
        authority,
    };
    let (router, _) = routes().split_for_parts();
    router
        .fallback(|| async { Error::NotFound })
        .layer(axum::extract::DefaultBodyLimit::max(64 * 1024))
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            local_only,
        ))
        .layer(axum::middleware::from_fn(crate::telemetry::observe_http))
        .with_state(state)
}

fn desktop_origin(origin: &str) -> bool {
    matches!(
        origin,
        "http://wails.localhost"
            | "http://wails.localhost:9245"
            | "http://wails.localhost:34115"
            | "wails://localhost"
            | "wails://localhost:9245"
            | "wails://wails"
            | "wails://wails:34115"
            | "wails://wails.localhost:34115"
    )
}

async fn local_only(
    axum::extract::State(state): axum::extract::State<State>,
    request: axum::extract::Request,
    next: axum::middleware::Next,
) -> axum::response::Response {
    let host = request
        .headers()
        .get(axum::http::header::HOST)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("");
    let authority = host.parse::<axum::http::uri::Authority>().ok();
    let local = authority.as_ref().is_some_and(|authority| {
        authority.port_u16() == Some(state.authority.port())
            && (authority.host() == "localhost"
                || authority
                    .host()
                    .trim_matches(['[', ']'])
                    .parse::<std::net::IpAddr>()
                    .is_ok_and(|address| address.is_loopback()))
    });
    let origin = request
        .headers()
        .get(axum::http::header::ORIGIN)
        .and_then(|value| value.to_str().ok())
        .filter(|value| !value.is_empty())
        .map(str::to_owned);
    let trusted = origin.as_deref().is_some_and(desktop_origin);
    let same_origin = origin
        .as_deref()
        .is_none_or(|origin| origin == format!("http://{host}"));
    let cross_site = request
        .headers()
        .get("Sec-Fetch-Site")
        .is_some_and(|value| value == "cross-site");
    let mut response = if !local || !trusted && (!same_origin || cross_site) {
        Error::Forbidden.into_response()
    } else if trusted && request.method() == axum::http::Method::OPTIONS {
        let method = request
            .headers()
            .get("Access-Control-Request-Method")
            .and_then(|value| value.to_str().ok())
            .unwrap_or("");
        let headers = request
            .headers()
            .get("Access-Control-Request-Headers")
            .and_then(|value| value.to_str().ok())
            .unwrap_or("");
        if !matches!(method, "GET" | "POST" | "DELETE" | "HEAD")
            || headers.split(',').any(|header| {
                !matches!(
                    header.trim().to_ascii_lowercase().as_str(),
                    "" | "content-type" | "range" | "if-range" | "if-none-match"
                )
            })
        {
            Error::Forbidden.into_response()
        } else {
            (
                axum::http::StatusCode::NO_CONTENT,
                [
                    ("Access-Control-Allow-Methods", "GET, POST, DELETE, HEAD"),
                    (
                        "Access-Control-Allow-Headers",
                        "Content-Type, Range, If-Range, If-None-Match",
                    ),
                ],
            )
                .into_response()
        }
    } else {
        next.run(request).await
    };
    if response.status() == axum::http::StatusCode::BAD_REQUEST
        && !response
            .headers()
            .get(axum::http::header::CONTENT_TYPE)
            .is_some_and(|value| value == "application/json")
    {
        response = Error::InvalidInput("Invalid request parameters".into()).into_response();
    }
    response.headers_mut().insert(
        "X-Content-Type-Options",
        axum::http::HeaderValue::from_static("nosniff"),
    );
    response.headers_mut().insert(
        axum::http::header::CACHE_CONTROL,
        axum::http::HeaderValue::from_static("no-store"),
    );
    if trusted
        && let Some(origin) =
            origin.and_then(|origin| origin.parse::<axum::http::HeaderValue>().ok())
    {
        response
            .headers_mut()
            .insert("Access-Control-Allow-Origin", origin);
        response.headers_mut().append(
            axum::http::header::VARY,
            axum::http::HeaderValue::from_static("Origin"),
        );
        response.headers_mut().insert(
            "Access-Control-Expose-Headers",
            axum::http::HeaderValue::from_static("Content-Disposition, ETag"),
        );
    }
    response
}

#[utoipa::path(
    get,
    path = "/healthz",
    operation_id = "health",
    summary = "Check HTTP process",
    description = "Reports HTTP process availability without starting browser work.",
    responses(
        (status = 200, body = Health),
        (status = 403, body = ErrorBody)
    )
)]
async fn health() -> axum::Json<Health> {
    axum::Json(Health {
        status: "ok",
        service: "ku-potato-server",
    })
}

#[utoipa::path(
    get,
    path = "/openapi.json",
    summary = "Read the generated OpenAPI document",
    description = "Generated from the same Rust routes and schemas used by this server.",
    responses(
        (status = 200, body = serde_json::Value),
        (status = 403, body = ErrorBody)
    )
)]
async fn specification() -> axum::Json<utoipa::openapi::OpenApi> {
    axum::Json(openapi())
}

#[utoipa::path(
    get,
    path = "/auth",
    operation_id = "getCachedAuthenticationState",
    summary = "Read cached Kogakuin SSO authentication state",
    description = "Returns the last observed Kogakuin SSO authentication state without starting an authentication check.",
    responses(
        (status = 200, body = Data<crate::model::Authentication>),
        (status = 403, body = ErrorBody)
    )
)]
async fn cached_kogakuin_sso(
    axum::extract::State(state): axum::extract::State<State>,
) -> axum::Json<Data<crate::model::Authentication>> {
    axum::Json(Data {
        data: state
            .operations
            .cached_authentication(crate::user_browser::Provider::KogakuinSso)
            .await,
    })
}

#[utoipa::path(
    get,
    path = "/auth/google",
    operation_id = "getCachedGoogleAuthenticationState",
    summary = "Read cached Google authentication state",
    description = "Returns the last observed Google authentication state without starting an authentication check.",
    responses(
        (status = 200, body = Data<crate::model::Authentication>),
        (status = 403, body = ErrorBody)
    )
)]
async fn cached_google(
    axum::extract::State(state): axum::extract::State<State>,
) -> axum::Json<Data<crate::model::Authentication>> {
    axum::Json(Data {
        data: state
            .operations
            .cached_authentication(crate::user_browser::Provider::Google)
            .await,
    })
}

#[utoipa::path(
    get,
    path = "/auth/webauthn",
    operation_id = "getWebAuthn",
    summary = "Read saved WebAuthn credential state",
    description = "Reports whether a saved virtual WebAuthn credential is registered.",
    responses(
        (status = 200, body = Data<crate::model::Registration>),
        (status = 403, body = ErrorBody),
        (
            status = 502,
            description = "The user browser failed to read credential state.",
            body = ErrorBody
        ),
        (status = 503, description = "The user browser service is unavailable.", body = ErrorBody),
        (status = 504, description = "The credential state request timed out.", body = ErrorBody)
    )
)]
async fn registration(
    axum::extract::State(state): axum::extract::State<State>,
) -> Result<axum::Json<Data<crate::model::Registration>>, Error> {
    Ok(axum::Json(Data {
        data: crate::model::Registration {
            registered: state
                .operations
                .user_browser
                .is_web_authn_credential_registered()
                .await
                .map_err(Error::WebAuthnState)?,
        },
    }))
}

#[utoipa::path(
    post,
    path = "/auth/login",
    operation_id = "login",
    request_body = AuthenticationInput,
    summary = "Log in to Kogakuin SSO",
    description = STREAM_DESCRIPTION,
    responses(
        (
            status = 200,
            body = [StreamEvent<crate::model::Authentication>],
            content_type = "text/event-stream"
        ),
        (status = 400, body = ErrorBody),
        (status = 403, body = ErrorBody),
        (status = 413, body = ErrorBody)
    )
)]
async fn login(
    axum::extract::State(state): axum::extract::State<State>,
    input: Result<axum::Json<AuthenticationInput>, axum::extract::rejection::JsonRejection>,
) -> Result<axum::response::Response, Error> {
    let axum::Json(input) = input?;
    Ok(stream_operation(
        state.operations,
        crate::operation::Request::Login {
            provider: crate::user_browser::Provider::KogakuinSso,
            interactive: input.interactive,
        },
    )
    .await)
}

#[utoipa::path(
    post,
    path = "/auth/google/login",
    operation_id = "googleLogin",
    request_body = AuthenticationInput,
    summary = "Log in to Google and save the session",
    description = STREAM_DESCRIPTION,
    responses(
        (
            status = 200,
            body = [StreamEvent<crate::model::Authentication>],
            content_type = "text/event-stream"
        ),
        (status = 400, body = ErrorBody),
        (status = 403, body = ErrorBody),
        (status = 413, body = ErrorBody)
    )
)]
async fn google_login(
    axum::extract::State(state): axum::extract::State<State>,
    input: Result<axum::Json<AuthenticationInput>, axum::extract::rejection::JsonRejection>,
) -> Result<axum::response::Response, Error> {
    let axum::Json(input) = input?;
    Ok(stream_operation(
        state.operations,
        crate::operation::Request::Login {
            provider: crate::user_browser::Provider::Google,
            interactive: input.interactive,
        },
    )
    .await)
}

#[utoipa::path(
    post,
    path = "/auth/check",
    operation_id = "checkAuthentication",
    summary = "Check Kogakuin SSO authentication",
    description = STREAM_DESCRIPTION,
    responses(
        (
            status = 200,
            body = [StreamEvent<crate::model::Authentication>],
            content_type = "text/event-stream"
        ),
        (status = 403, body = ErrorBody)
    )
)]
async fn check(
    axum::extract::State(state): axum::extract::State<State>,
) -> axum::response::Response {
    stream_operation(
        state.operations,
        crate::operation::Request::CheckAuthentication(crate::user_browser::Provider::KogakuinSso),
    )
    .await
}

#[utoipa::path(
    post,
    path = "/auth/google/check",
    operation_id = "checkGoogleAuthentication",
    summary = "Check the saved Google session",
    description = STREAM_DESCRIPTION,
    responses(
        (
            status = 200,
            body = [StreamEvent<crate::model::Authentication>],
            content_type = "text/event-stream"
        ),
        (status = 403, body = ErrorBody)
    )
)]
async fn google_check(
    axum::extract::State(state): axum::extract::State<State>,
) -> axum::response::Response {
    stream_operation(
        state.operations,
        crate::operation::Request::CheckAuthentication(crate::user_browser::Provider::Google),
    )
    .await
}

#[utoipa::path(
    post,
    path = "/auth/webauthn",
    operation_id = "registerWebAuthn",
    request_body = AuthenticationInput,
    summary = "Register virtual WebAuthn credential",
    description = STREAM_DESCRIPTION,
    responses(
        (
            status = 200,
            body = [StreamEvent<crate::model::Registration>],
            content_type = "text/event-stream"
        ),
        (status = 400, body = ErrorBody),
        (status = 403, body = ErrorBody),
        (status = 413, body = ErrorBody)
    )
)]
async fn register(
    axum::extract::State(state): axum::extract::State<State>,
    input: Result<axum::Json<AuthenticationInput>, axum::extract::rejection::JsonRejection>,
) -> Result<axum::response::Response, Error> {
    let axum::Json(input) = input?;
    Ok(stream_operation(
        state.operations,
        crate::operation::Request::RegisterWebAuthnCredential {
            interactive: input.interactive,
        },
    )
    .await)
}

#[utoipa::path(
    delete,
    path = "/auth/webauthn",
    operation_id = "deleteWebAuthn",
    summary = "Delete saved WebAuthn credential",
    description = STREAM_DESCRIPTION,
    responses(
        (
            status = 200,
            body = [StreamEvent<crate::model::Registration>],
            content_type = "text/event-stream"
        ),
        (status = 403, body = ErrorBody)
    )
)]
async fn delete_registration(
    axum::extract::State(state): axum::extract::State<State>,
) -> axum::response::Response {
    stream_operation(
        state.operations,
        crate::operation::Request::DeleteWebAuthnCredential,
    )
    .await
}

#[utoipa::path(
    get,
    path = "/courses",
    operation_id = "listCourses",
    params(Synchronization),
    summary = "Read or synchronize courses",
    description = STREAM_DESCRIPTION,
    responses(
        (
            status = 200,
            body = [StreamEvent<Vec<crate::model::Course>>],
            content_type = "text/event-stream"
        ),
        (status = 400, body = ErrorBody),
        (status = 403, body = ErrorBody)
    )
)]
async fn courses(
    axum::extract::State(state): axum::extract::State<State>,
    axum::extract::Query(input): axum::extract::Query<Synchronization>,
) -> axum::response::Response {
    stream_operation(
        state.operations,
        crate::operation::Request::Courses(input.sync),
    )
    .await
}

#[utoipa::path(
    get,
    path = "/courses/{courseId}/materials",
    operation_id = "listMaterials",
    params(
        ("courseId" = crate::model::CourseId, Path),
        Synchronization
    ),
    summary = "Read or synchronize course materials",
    description = STREAM_DESCRIPTION,
    responses(
        (
            status = 200,
            body = [StreamEvent<crate::model::CourseMaterials>],
            content_type = "text/event-stream"
        ),
        (status = 400, body = ErrorBody),
        (status = 403, body = ErrorBody)
    )
)]
async fn materials(
    axum::extract::State(state): axum::extract::State<State>,
    axum::extract::Path(course): axum::extract::Path<crate::model::CourseId>,
    axum::extract::Query(input): axum::extract::Query<Synchronization>,
) -> axum::response::Response {
    stream_operation(
        state.operations,
        crate::operation::Request::Materials {
            course,
            policy: input.sync,
        },
    )
    .await
}

fn parse_assignment_query(raw: Option<&str>) -> Result<crate::operation::Request, Error> {
    let mut policy = None;
    let mut courses = Vec::new();
    for (name, value) in url::form_urlencoded::parse(raw.unwrap_or("").as_bytes()) {
        match name.as_ref() {
            "sync" if policy.is_none() => {
                policy = Some(
                    serde_json::from_value(serde_json::Value::String(value.into_owned())).map_err(
                        |_| Error::InvalidInput("sync must be auto, true, or false".into()),
                    )?,
                );
            }
            "sync" => {
                return Err(Error::InvalidInput("sync must not be repeated".into()));
            }
            "courseId" if courses.len() < 500 => courses.push(value.into_owned().try_into()?),
            "courseId" => return Err(Error::InvalidInput("Too many courses".into())),
            _ => (),
        }
    }
    Ok(crate::operation::Request::Assignments {
        courses,
        policy: policy.unwrap_or_default(),
    })
}

#[utoipa::path(
    get,
    path = "/assignments",
    operation_id = "listAssignments",
    params(
        Synchronization,
        (
            "courseId" = Option<Vec<crate::model::CourseId>>,
            Query,
            style = Form,
            explode = true,
            max_items = 500,
            description = "Repeat to select courses; omission uses the courses selected by the synchronization policy."
        )
    ),
    summary = "Read or synchronize assignments",
    description = STREAM_DESCRIPTION,
    responses(
        (
            status = 200,
            body = [StreamEvent<crate::model::Assignments>],
            content_type = "text/event-stream"
        ),
        (status = 400, body = ErrorBody),
        (status = 403, body = ErrorBody)
    )
)]
async fn assignments(
    axum::extract::State(state): axum::extract::State<State>,
    axum::extract::RawQuery(raw): axum::extract::RawQuery,
) -> Result<axum::response::Response, Error> {
    let request = parse_assignment_query(raw.as_deref())?;
    Ok(stream_operation(state.operations, request).await)
}

#[utoipa::path(
    get,
    path = "/materials/{materialId}",
    operation_id = "getMaterial",
    params(
        ("materialId" = crate::model::MaterialId, Path),
        Synchronization
    ),
    summary = "Read or synchronize material details",
    description = STREAM_DESCRIPTION,
    responses(
        (
            status = 200,
            body = [StreamEvent<crate::model::Detail>],
            content_type = "text/event-stream"
        ),
        (status = 400, body = ErrorBody),
        (status = 403, body = ErrorBody)
    )
)]
async fn detail(
    axum::extract::State(state): axum::extract::State<State>,
    axum::extract::Path(material): axum::extract::Path<crate::model::MaterialId>,
    axum::extract::Query(input): axum::extract::Query<Synchronization>,
) -> axum::response::Response {
    stream_operation(
        state.operations,
        crate::operation::Request::Detail {
            material,
            policy: input.sync,
        },
    )
    .await
}

#[utoipa::path(
    post,
    path = "/materials/{materialId}/resources/{resourceId}/download",
    operation_id = "downloadResource",
    params(
        ("materialId" = crate::model::MaterialId, Path),
        ("resourceId" = crate::model::ResourceId, Path)
    ),
    summary = "Acquire and save an LMS file or return an external link",
    description = STREAM_DESCRIPTION,
    responses(
        (
            status = 200,
            body = [StreamEvent<crate::model::Download>],
            content_type = "text/event-stream"
        ),
        (status = 400, body = ErrorBody),
        (status = 403, body = ErrorBody)
    )
)]
async fn download(
    axum::extract::State(state): axum::extract::State<State>,
    axum::extract::Path(ResourceIdentifiers {
        material_id: material,
        resource_id: resource,
    }): axum::extract::Path<ResourceIdentifiers>,
) -> axum::response::Response {
    stream_operation(
        state.operations,
        crate::operation::Request::Download { material, resource },
    )
    .await
}

async fn stream_operation(
    operations: std::sync::Arc<crate::operation::Coordinator>,
    request: crate::operation::Request,
) -> axum::response::Response {
    let mut observation = operations.observe_or_start(request).await;
    let stream = async_stream::stream! {
        loop {
            let update = observation.borrow_and_update().clone();
            match update {
                crate::operation::Update::Running(progress) => {
                    yield StreamEvent::<serde_json::Value>::Status(OperationStatus {
                        status: OperationState::Running,
                        attempt: std::num::NonZeroU32::MIN,
                        progress
                    })
                    .into_sse();
                }
                crate::operation::Update::Finished(result) => {
                    let status = match &result {
                        Ok(_) => OperationState::Succeeded,
                        Err(error)
                            if error.reason == crate::error::Reason::AuthenticationRequired =>
                            OperationState::Blocked,
                        Err(error) if error.reason == crate::error::Reason::Cancelled =>
                            OperationState::Cancelled,
                        Err(_) => OperationState::Failed,
                    };
                    yield StreamEvent::<serde_json::Value>::Status(OperationStatus {
                        status,
                        attempt: std::num::NonZeroU32::MIN,
                        progress: crate::operation::Progress {
                            stage: crate::operation::Stage::Completed,
                            completed: usize::from(result.is_ok()),
                            total: 1,
                            course: None
                        },
                    })
                    .into_sse();
                    yield match result {
                        Ok(data) => StreamEvent::Result(Data { data }).into_sse(),
                        Err(error) => StreamEvent::<serde_json::Value>::Error(OperationErrorBody {
                            error
                        })
                        .into_sse(),
                    };
                    break;
                }
            }
            if observation.changed().await.is_err() {
                break;
            }
        }
    };
    axum::response::Sse::new(stream)
        .keep_alive(axum::response::sse::KeepAlive::default())
        .into_response()
}

#[utoipa::path(
    post,
    path = "/materials/{materialId}/resources/{resourceId}/prepare",
    operation_id = "prepareResource",
    params(
        ("materialId" = crate::model::MaterialId, Path),
        ("resourceId" = crate::model::ResourceId, Path)
    ),
    summary = "Materialize a saved resource for local clients",
    description = "Verifies and materializes saved content and returns its local filesystem path. Does not download missing content.",
    responses(
        (status = 200, body = Data<ResourcePath>),
        (status = 400, body = ErrorBody),
        (status = 403, body = ErrorBody),
        (status = 404, body = ErrorBody),
        (status = 500, body = ErrorBody)
    )
)]
async fn prepare(
    axum::extract::State(state): axum::extract::State<State>,
    axum::extract::Path(ResourceIdentifiers {
        material_id: material,
        resource_id: resource,
    }): axum::extract::Path<ResourceIdentifiers>,
) -> Result<axum::Json<Data<ResourcePath>>, Error> {
    let metadata = state
        .operations
        .archive
        .saved_file(&material, &resource)
        .await?;
    let path = state.operations.files.materialize(metadata).await?;
    Ok(axum::Json(Data {
        data: ResourcePath { path },
    }))
}

#[utoipa::path(
    get,
    path = "/materials/{materialId}/resources/{resourceId}/file",
    operation_id = "getSavedFile",
    params(
        ("materialId" = crate::model::MaterialId, Path),
        ("resourceId" = crate::model::ResourceId, Path),
        ("Range" = Option<String>, Header, description = "Byte range to retrieve."),
        (
            "If-Range" = Option<String>,
            Header,
            description = "Apply Range only if the saved file's ETag matches."
        ),
        (
            "If-None-Match" = Option<String>,
            Header,
            description = "Return 304 if the saved file's ETag matches."
        )
    ),
    summary = "Serve a saved file",
    description = "Serves verified saved content with range requests and ETag conditionals. Does not download missing content.",
    responses(
        (status = 200, body = inline(Binary), content_type = "application/octet-stream"),
        (status = 206, body = inline(Binary), content_type = "application/octet-stream"),
        (status = 304),
        (status = 416),
        (status = 400, body = ErrorBody),
        (status = 403, body = ErrorBody),
        (status = 404, body = ErrorBody),
        (status = 500, body = ErrorBody)
    )
)]
async fn file(
    axum::extract::State(state): axum::extract::State<State>,
    axum::extract::Path(ResourceIdentifiers {
        material_id: material,
        resource_id: resource,
    }): axum::extract::Path<ResourceIdentifiers>,
    request: axum::extract::Request,
) -> Result<axum::response::Response, Error> {
    let metadata = state
        .operations
        .archive
        .saved_file(&material, &resource)
        .await?;
    serve_file(&state.operations.files, metadata, request).await
}

async fn serve_file(
    files: &crate::files::Store,
    metadata: crate::model::SavedFile,
    mut request: axum::extract::Request,
) -> Result<axum::response::Response, Error> {
    let tag = format!("\"{}\"", metadata.content_hash.as_ref());
    if request
        .headers()
        .get(axum::http::header::IF_NONE_MATCH)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| {
            value
                .split(',')
                .any(|value| value.trim() == "*" || value.trim().trim_start_matches("W/") == tag)
        })
    {
        return Ok((
            axum::http::StatusCode::NOT_MODIFIED,
            [(axum::http::header::ETAG, tag)],
        )
            .into_response());
    }
    if request
        .headers()
        .get(axum::http::header::IF_RANGE)
        .is_some_and(|value| value != tag.as_str())
    {
        request.headers_mut().remove(axum::http::header::RANGE);
    }
    request.headers_mut().remove(axum::http::header::IF_RANGE);
    let path = files.materialize(metadata.clone()).await?;
    let mut response = tower_http::services::ServeFile::new(path)
        .oneshot(request)
        .await
        .unwrap_or_else(|error| match error {})
        .map(axum::body::Body::new);
    response.headers_mut().insert(
        axum::http::header::ETAG,
        tag.parse().map_err(Error::Header)?,
    );
    response.headers_mut().insert(
        axum::http::header::CONTENT_TYPE,
        axum::http::HeaderValue::from_static("application/octet-stream"),
    );
    let filename = crate::files::safe_filename(&metadata.original_filename);
    let encoded =
        percent_encoding::utf8_percent_encode(&filename, percent_encoding::NON_ALPHANUMERIC);
    response.headers_mut().insert(
        axum::http::header::CONTENT_DISPOSITION,
        format!("attachment; filename=\"resource\"; filename*=UTF-8''{encoded}")
            .parse()
            .map_err(Error::Header)?,
    );
    Ok(response)
}

#[utoipa::path(
    head,
    path = "/materials/{materialId}/resources/{resourceId}/file",
    operation_id = "headSavedFile",
    params(
        ("materialId" = crate::model::MaterialId, Path),
        ("resourceId" = crate::model::ResourceId, Path),
        ("Range" = Option<String>, Header, description = "Byte range to retrieve."),
        (
            "If-Range" = Option<String>,
            Header,
            description = "Apply Range only if the saved file's ETag matches."
        ),
        (
            "If-None-Match" = Option<String>,
            Header,
            description = "Return 304 if the saved file's ETag matches."
        )
    ),
    summary = "Read saved file headers",
    description = "Returns the same headers as a saved-file GET request without a response body.",
    responses(
        (status = 200),
        (status = 206),
        (status = 304),
        (status = 416),
        (status = 400),
        (status = 403),
        (status = 404),
        (status = 500)
    )
)]
async fn head_file(
    state: axum::extract::State<State>,
    path: axum::extract::Path<ResourceIdentifiers>,
    request: axum::extract::Request,
) -> Result<axum::response::Response, Error> {
    file(state, path, request).await
}

#[utoipa::path(
    post,
    path = "/google-drive/files/download",
    operation_id = "downloadGoogleDriveFile",
    request_body = GoogleDriveDownloadInput,
    summary = "Acquire and save a Google Drive file",
    description = STREAM_DESCRIPTION,
    responses(
        (
            status = 200,
            body = [StreamEvent<crate::model::GoogleDriveDownload>],
            content_type = "text/event-stream"
        ),
        (status = 400, body = ErrorBody),
        (status = 403, body = ErrorBody),
        (status = 413, body = ErrorBody)
    )
)]
async fn google_drive_download(
    axum::extract::State(state): axum::extract::State<State>,
    input: Result<axum::Json<GoogleDriveDownloadInput>, axum::extract::rejection::JsonRejection>,
) -> Result<axum::response::Response, Error> {
    let axum::Json(input) = input?;
    Ok(stream_operation(
        state.operations,
        crate::operation::Request::DownloadGoogleDrive { url: input.url },
    )
    .await)
}

#[utoipa::path(
    post,
    path = "/google-drive/files/{fileId}/prepare",
    operation_id = "prepareGoogleDriveFile",
    params(("fileId" = crate::model::GoogleDriveFileId, Path)),
    summary = "Materialize a saved Google Drive file for local clients",
    description = "Verifies and materializes a saved Google Drive file and returns its local filesystem path. Does not download missing content.",
    responses(
        (status = 200, body = Data<ResourcePath>),
        (status = 400, body = ErrorBody),
        (status = 403, body = ErrorBody),
        (status = 404, body = ErrorBody),
        (status = 500, body = ErrorBody)
    )
)]
async fn google_drive_prepare(
    axum::extract::State(state): axum::extract::State<State>,
    axum::extract::Path(file): axum::extract::Path<crate::model::GoogleDriveFileId>,
) -> Result<axum::Json<Data<ResourcePath>>, Error> {
    let metadata = state
        .operations
        .archive
        .google_drive_saved_file(&file)
        .await?;
    let path = state.operations.files.materialize(metadata).await?;
    Ok(axum::Json(Data {
        data: ResourcePath { path },
    }))
}

#[utoipa::path(
    get,
    path = "/google-drive/files/{fileId}/file",
    operation_id = "getGoogleDriveSavedFile",
    params(
        ("fileId" = crate::model::GoogleDriveFileId, Path),
        ("Range" = Option<String>, Header),
        ("If-Range" = Option<String>, Header),
        ("If-None-Match" = Option<String>, Header)
    ),
    summary = "Serve a saved Google Drive file",
    description = "Serves verified Google Drive content with range requests and ETag conditionals. Does not download missing content.",
    responses(
        (status = 200, body = inline(Binary), content_type = "application/octet-stream"),
        (status = 206, body = inline(Binary), content_type = "application/octet-stream"),
        (status = 304),
        (status = 416),
        (status = 400, body = ErrorBody),
        (status = 403, body = ErrorBody),
        (status = 404, body = ErrorBody),
        (status = 500, body = ErrorBody)
    )
)]
async fn google_drive_file(
    axum::extract::State(state): axum::extract::State<State>,
    axum::extract::Path(file): axum::extract::Path<crate::model::GoogleDriveFileId>,
    request: axum::extract::Request,
) -> Result<axum::response::Response, Error> {
    let metadata = state
        .operations
        .archive
        .google_drive_saved_file(&file)
        .await?;
    serve_file(&state.operations.files, metadata, request).await
}

#[utoipa::path(
    head,
    path = "/google-drive/files/{fileId}/file",
    operation_id = "headGoogleDriveSavedFile",
    params(
        ("fileId" = crate::model::GoogleDriveFileId, Path),
        ("Range" = Option<String>, Header),
        ("If-Range" = Option<String>, Header),
        ("If-None-Match" = Option<String>, Header)
    ),
    summary = "Read saved Google Drive file headers",
    description = "Returns the same headers as a Google Drive saved-file GET request without a response body.",
    responses(
        (status = 200),
        (status = 206),
        (status = 304),
        (status = 416),
        (status = 400),
        (status = 403),
        (status = 404),
        (status = 500)
    )
)]
async fn google_drive_head_file(
    state: axum::extract::State<State>,
    path: axum::extract::Path<crate::model::GoogleDriveFileId>,
    request: axum::extract::Request,
) -> Result<axum::response::Response, Error> {
    google_drive_file(state, path, request).await
}

#[cfg(test)]
mod tests {
    use axum::response::IntoResponse as _;
    use tower::ServiceExt as _;

    #[test]
    fn invalid_input_and_invalid_archive_data_have_different_statuses() {
        let input = super::Error::from(crate::model::InvalidValue { field: "course ID" });
        let archive = super::Error::from(crate::archive::Error::from(crate::model::InvalidValue {
            field: "course ID",
        }));
        assert_eq!(
            super::error::Details::from(&input).reason,
            super::error::Reason::InvalidInput
        );
        assert_eq!(
            super::error::Details::from(&archive).reason,
            super::error::Reason::Archive
        );
        assert_eq!(
            input.into_response().status(),
            axum::http::StatusCode::BAD_REQUEST
        );
        assert_eq!(
            archive.into_response().status(),
            axum::http::StatusCode::INTERNAL_SERVER_ERROR
        );
    }

    async fn response(
        router: &axum::Router,
        method: &str,
        uri: &str,
        headers: &[(&str, &str)],
        body: &str,
    ) -> axum::response::Response {
        let mut request = axum::http::Request::builder()
            .method(method)
            .uri(uri)
            .header("Host", "127.0.0.1:8787");
        for (name, value) in headers {
            request = request.header(*name, *value);
        }
        router
            .clone()
            .oneshot(
                request
                    .body(axum::body::Body::from(body.to_owned()))
                    .unwrap(),
            )
            .await
            .unwrap()
    }

    async fn bytes(response: axum::response::Response) -> Vec<u8> {
        axum::body::to_bytes(response.into_body(), 1 << 20)
            .await
            .unwrap()
            .to_vec()
    }

    fn validator(schema: serde_json::Value) -> jsonschema::Validator {
        let document = serde_json::to_value(super::openapi()).unwrap();
        jsonschema::validator_for(
            &serde_json::json!({ "allOf": [schema], "components": document["components"] }),
        )
        .unwrap()
    }

    fn validate_response(
        method: &str,
        uri: &str,
        status: u16,
        media: &str,
        value: &serde_json::Value,
    ) {
        let document = serde_json::to_value(super::openapi()).unwrap();
        let path = uri.split('?').next().unwrap();
        let operation = document["paths"]
            .as_object()
            .unwrap()
            .iter()
            .find_map(|(pattern, item)| {
                let expected: Vec<_> = pattern.split('/').collect();
                let actual: Vec<_> = path.split('/').collect();
                (expected.len() == actual.len()
                    && expected
                        .iter()
                        .zip(actual)
                        .all(|(expected, actual)| expected.starts_with('{') || *expected == actual))
                .then_some(&item[method.to_ascii_lowercase()])
            })
            .unwrap();
        let schema = operation["responses"][status.to_string()]["content"][media]["schema"].clone();
        assert!(
            !schema.is_null(),
            "{method} {uri}: undocumented {status} {media}"
        );
        let validator = validator(schema);
        let errors: Vec<_> = validator
            .iter_errors(value)
            .map(|error| error.to_string())
            .collect();
        assert!(errors.is_empty(), "{method} {uri}: {errors:?}\n{value}");
    }

    async fn stream(
        router: &axum::Router,
        method: &str,
        uri: &str,
        body: &str,
    ) -> Vec<(String, serde_json::Value)> {
        let response = response(
            router,
            method,
            uri,
            &[("Content-Type", "application/json")],
            body,
        )
        .await;
        assert_eq!(response.status(), 200, "{uri}");
        assert!(
            response.headers()["content-type"]
                .to_str()
                .unwrap()
                .starts_with("text/event-stream")
        );
        let text = String::from_utf8(bytes(response).await).unwrap();
        let mut events = Vec::new();
        for frame in text.split("\n\n") {
            let mut name = None;
            let mut data = None;
            for line in frame.lines() {
                if let Some(value) = line.strip_prefix("event:") {
                    name = Some(value.trim().to_owned());
                }
                if let Some(value) = line.strip_prefix("data:") {
                    data = Some(serde_json::from_str(value.trim()).unwrap());
                }
            }
            if let Some((name, data)) = name.zip(data) {
                events.push((name, data));
            }
        }
        assert_eq!(
            events
                .iter()
                .filter(|(name, _)| name == "result" || name == "error")
                .count(),
            1,
            "{text}"
        );
        let frames: Vec<_> = events
            .iter()
            .map(|(event, data)| serde_json::json!({ "event": event, "data": data }))
            .collect();
        validate_response(
            method,
            uri,
            200,
            "text/event-stream",
            &serde_json::json!(frames),
        );
        events
    }

    #[tokio::test]
    async fn credential_state_rpc_failures_use_documented_dependency_responses() {
        let fixture = crate::rpc::tests::Fixture::new().await;
        let operations = fixture.operations().await;
        let router = super::router(operations.clone(), "127.0.0.1:8787".parse().unwrap());
        struct Case {
            code: tonic::Code,
            status: u16,
            reason: &'static str,
        }
        for case in [
            Case {
                code: tonic::Code::Cancelled,
                status: 502,
                reason: "dependency-failed",
            },
            Case {
                code: tonic::Code::Internal,
                status: 502,
                reason: "dependency-failed",
            },
            Case {
                code: tonic::Code::Unauthenticated,
                status: 502,
                reason: "dependency-failed",
            },
            Case {
                code: tonic::Code::FailedPrecondition,
                status: 502,
                reason: "dependency-failed",
            },
            Case {
                code: tonic::Code::Unavailable,
                status: 503,
                reason: "dependency-unavailable",
            },
            Case {
                code: tonic::Code::DeadlineExceeded,
                status: 504,
                reason: "dependency-timeout",
            },
        ] {
            *fixture.service.registration_error.lock().unwrap() =
                Some(tonic::Status::new(case.code, "private diagnostics"));
            let result = response(&router, "GET", "/auth/webauthn", &[], "").await;
            assert_eq!(result.status().as_u16(), case.status, "{:?}", case.code);
            let body: serde_json::Value = serde_json::from_slice(&bytes(result).await).unwrap();
            assert_eq!(body["error"]["reason"], case.reason);
            assert!(!body.to_string().contains("private"));
            validate_response(
                "GET",
                "/auth/webauthn",
                case.status,
                "application/json",
                &body,
            );
        }
        operations.shutdown().await;
    }

    #[tokio::test]
    async fn authentication_cancellation_is_not_a_failure_or_an_authentication_requirement() {
        let fixture = crate::rpc::tests::Fixture::new().await;
        *fixture.service.authentication_error.lock().unwrap() =
            Some(tonic::Status::cancelled("private window details"));
        let operations = fixture.operations().await;
        let router = super::router(operations.clone(), "127.0.0.1:8787".parse().unwrap());
        for path in ["/auth/login", "/auth/google/login", "/auth/webauthn"] {
            let events = stream(&router, "POST", path, r#"{"interactive":true}"#).await;
            assert_eq!(
                events[events.len() - 2].1["status"],
                "cancelled",
                "{events:?}"
            );
            assert_eq!(
                events.last().unwrap().1["error"],
                serde_json::json!({
                    "reason": "cancelled",
                    "message": "The browser operation was cancelled",
                }),
            );
        }
        for provider in [
            crate::user_browser::Provider::KogakuinSso,
            crate::user_browser::Provider::Google,
        ] {
            assert!(matches!(
                operations.cached_authentication(provider).await,
                crate::model::Authentication::Unknown
            ));
        }
        // Cancellation must release active work so the same request can succeed.
        *fixture.service.authentication_error.lock().unwrap() = None;
        let events = stream(
            &router,
            "POST",
            "/auth/google/login",
            r#"{"interactive":true}"#,
        )
        .await;
        assert_eq!(events.last().unwrap().0, "result");
        operations.shutdown().await;
    }

    #[tokio::test]
    async fn authentication_requirements_and_conflicts_are_streamed_operation_outcomes() {
        let fixture = crate::rpc::tests::Fixture::new().await;
        let operations = fixture.operations().await;
        let router = super::router(operations.clone(), "127.0.0.1:8787".parse().unwrap());
        struct Case {
            reason: crate::user_browser::protocol::FailureReason,
            state: &'static str,
            public_reason: &'static str,
            message: &'static str,
        }
        for case in [
            Case {
                reason: crate::user_browser::protocol::FailureReason::AuthenticationRequired,
                state: "blocked",
                public_reason: "authentication-required",
                message: "Authentication is required",
            },
            Case {
                reason: crate::user_browser::protocol::FailureReason::Conflict,
                state: "failed",
                public_reason: "conflict",
                message: "Credential already registered",
            },
        ] {
            let failure = crate::user_browser::protocol::Failure {
                reason: case.reason.into(),
                message: case.message.into(),
            };
            let status = crate::rpc::Status {
                code: tonic::Code::FailedPrecondition as i32,
                message: failure.message.clone(),
                details: vec![prost_types::Any {
                    type_url: "type.googleapis.com/kupotato.userbrowser.v1.Failure".into(),
                    value: prost::Message::encode_to_vec(&failure),
                }],
            };
            *fixture.service.authentication_error.lock().unwrap() =
                Some(tonic::Status::with_details(
                    tonic::Code::FailedPrecondition,
                    &failure.message,
                    prost::Message::encode_to_vec(&status).into(),
                ));
            for path in ["/auth/login", "/auth/google/login", "/auth/webauthn"] {
                let events = stream(&router, "POST", path, "{}").await;
                assert_eq!(events[events.len() - 2].1["status"], case.state, "{path}");
                assert_eq!(events.last().unwrap().0, "error");
                assert_eq!(
                    events.last().unwrap().1["error"]["reason"],
                    case.public_reason
                );
            }
        }
        operations.shutdown().await;
    }

    #[test]
    fn http_and_operation_error_schemas_have_separate_reason_sets() {
        let http = validator(serde_json::json!({ "$ref": "#/components/schemas/ErrorBody" }));
        let operation =
            validator(serde_json::json!({ "$ref": "#/components/schemas/OperationErrorBody" }));
        for reason in [
            "cancelled",
            "authentication-required",
            "conflict",
            "course-not-found",
        ] {
            let body = serde_json::json!({ "error": { "reason": reason, "message": "Outcome" } });
            assert!(!http.is_valid(&body), "{reason}");
            assert!(operation.is_valid(&body), "{reason}");
        }
        for reason in [
            "invalid-input",
            "payload-too-large",
            "not-found",
            "dependency-failed",
            "dependency-unavailable",
            "dependency-timeout",
        ] {
            let body =
                serde_json::json!({ "error": { "reason": reason, "message": "Request failure" } });
            assert!(http.is_valid(&body), "{reason}");
            assert!(!operation.is_valid(&body), "{reason}");
        }
        let document = serde_json::to_value(super::openapi()).unwrap();
        for item in document["paths"].as_object().unwrap().values() {
            for operation in item.as_object().unwrap().values() {
                assert!(operation["responses"].get("409").is_none());
            }
        }
    }

    #[tokio::test]
    async fn generated_schemas_describe_every_feature_response() {
        let fixture = crate::rpc::tests::Fixture::new().await;
        let operations = fixture.operations().await;
        let router = super::router(operations.clone(), "127.0.0.1:8787".parse().unwrap());
        for (method, path, body) in [
            ("GET", "/courses?sync=true", ""),
            ("GET", "/courses/course1/materials?sync=true", ""),
            ("GET", "/materials/MAT1?sync=true", ""),
            ("GET", "/assignments?sync=false", ""),
            ("GET", "/assignments?sync=true&courseId=course1", ""),
            ("POST", "/materials/MAT1/resources/SRS1/download", ""),
            ("POST", "/auth/login", "{}"),
            ("POST", "/auth/check", ""),
            ("POST", "/auth/google/login", "{}"),
            ("POST", "/auth/google/check", ""),
            ("POST", "/auth/webauthn", "{}"),
            ("DELETE", "/auth/webauthn", ""),
        ] {
            let events = stream(&router, method, path, body).await;
            assert_eq!(events.last().unwrap().0, "result", "{path}: {events:?}");
        }
        for path in ["/healthz", "/auth", "/auth/google", "/auth/webauthn"] {
            let result = response(&router, "GET", path, &[], "").await;
            let status = result.status().as_u16();
            let body: serde_json::Value = serde_json::from_slice(&bytes(result).await).unwrap();
            validate_response("GET", path, status, "application/json", &body);
        }
        let path = "/materials/MAT1/resources/SRS1/prepare";
        let prepared = response(&router, "POST", path, &[], "").await;
        assert_eq!(prepared.status(), 200);
        let prepared: serde_json::Value = serde_json::from_slice(&bytes(prepared).await).unwrap();
        validate_response("POST", path, 200, "application/json", &prepared);
        assert_eq!(
            std::fs::read(prepared["data"]["path"].as_str().unwrap()).unwrap(),
            b"hello"
        );
        let document = response(&router, "GET", "/openapi.json", &[], "").await;
        assert_eq!(document.status(), 200);
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(&bytes(document).await).unwrap(),
            serde_json::to_value(super::openapi()).unwrap()
        );
        operations.shutdown().await;
    }

    #[test]
    fn generated_schemas_reject_invalid_states_and_operation_ids_are_unique() {
        let document = serde_json::to_value(super::openapi()).unwrap();
        fn check_references(value: &serde_json::Value, document: &serde_json::Value) {
            match value {
                serde_json::Value::Object(object) => {
                    if let Some(reference) = object.get("$ref").and_then(serde_json::Value::as_str)
                    {
                        assert!(
                            document
                                .pointer(reference.strip_prefix('#').unwrap())
                                .is_some(),
                            "{reference}"
                        );
                    }
                    for value in object.values() {
                        check_references(value, document);
                    }
                }
                serde_json::Value::Array(array) => {
                    for value in array {
                        check_references(value, document);
                    }
                }
                _ => (),
            }
        }
        check_references(&document, &document);
        let mut ids = std::collections::HashSet::new();
        for item in document["paths"].as_object().unwrap().values() {
            for operation in item.as_object().unwrap().values() {
                assert!(ids.insert(operation["operationId"].as_str().unwrap()));
                assert!(
                    operation["summary"]
                        .as_str()
                        .is_some_and(|value| !value.is_empty())
                );
                assert!(
                    operation["description"]
                        .as_str()
                        .is_some_and(|value| !value.is_empty())
                );
                if !operation["responses"]["200"]["content"]["text/event-stream"].is_null() {
                    assert_eq!(operation["description"], super::STREAM_DESCRIPTION);
                }
            }
        }
        assert_eq!(ids.len(), 23);
        assert!(
            document["components"]["schemas"]["AuthenticationInput"]["description"]
                .as_str()
                .unwrap()
                .contains("interactive")
        );
        assert!(
            document["paths"]["/courses"]["get"]["parameters"][0]["schema"]["description"]
                .as_str()
                .unwrap()
                .contains("auto")
        );
        let file = &document["paths"]["/materials/{materialId}/resources/{resourceId}/file"]["get"];
        for status in ["200", "206"] {
            let schema =
                &file["responses"][status]["content"]["application/octet-stream"]["schema"];
            assert_eq!(schema["type"], "string");
            assert_eq!(schema["format"], "binary");
        }
        let validator = validator(serde_json::json!({ "$ref": "#/components/schemas/Material" }));
        let mut material = serde_json::json!({
            "lmsMaterialId": "REP1",
            "name": "Report",
            "type": "report",
            "status": "unsubmitted",
            "publicationDeadlineKind": "unlisted",
            "materialLinkAvailable": true
        });
        assert!(validator.is_valid(&material));
        material["status"] = serde_json::json!("viewed");
        assert!(!validator.is_valid(&material));
        material["status"] = serde_json::json!("unsubmitted");
        material["publicationDeadlineKind"] = serde_json::json!("at");
        assert!(!validator.is_valid(&material));
        assert!(
            !document["components"]["schemas"]["Deadline"]
                .to_string()
                .contains("\"publicationDeadline\"")
        );
    }

    #[test]
    fn head_response_schemas_never_declare_response_bodies() {
        let document = serde_json::to_value(super::openapi()).unwrap();
        for path in [
            "/materials/{materialId}/resources/{resourceId}/file",
            "/google-drive/files/{fileId}/file",
        ] {
            let responses = document["paths"][path]["head"]["responses"]
                .as_object()
                .unwrap();
            for (status, response) in responses {
                assert!(response.get("content").is_none(), "HEAD {path}: {status}");
            }
            assert_eq!(
                responses.keys().collect::<Vec<_>>(),
                document["paths"][path]["get"]["responses"]
                    .as_object()
                    .unwrap()
                    .keys()
                    .collect::<Vec<_>>()
            );
            for status in ["400", "403", "404", "500"] {
                assert!(responses.contains_key(status));
                assert_eq!(
                    document["paths"][path]["get"]["responses"][status]["content"]["application/json"]
                        ["schema"]["$ref"],
                    "#/components/schemas/ErrorBody"
                );
            }
        }
    }

    #[test]
    fn google_drive_schema_examples_pass_schema_and_input_validation() {
        let document = serde_json::to_value(super::openapi()).unwrap();
        let schemas = &document["components"]["schemas"];
        let _: super::GoogleDriveDownloadInput =
            serde_json::from_value(schemas["GoogleDriveDownloadInput"]["example"].clone()).unwrap();
        let _: crate::model::GoogleDriveFile =
            serde_json::from_value(schemas["GoogleDriveFile"]["example"].clone()).unwrap();
        for name in ["GoogleDriveDownloadInput", "GoogleDriveFile"] {
            let validator =
                validator(serde_json::json!({ "$ref": format!("#/components/schemas/{name}") }));
            assert!(validator.is_valid(&schemas[name]["example"]), "{name}");
        }
    }

    #[tokio::test]
    async fn security_blocks_dns_rebinding_and_cross_origin_requests() {
        let fixture = crate::rpc::tests::Fixture::new().await;
        let operations = fixture.operations().await;
        let router = super::router(operations, "127.0.0.1:8787".parse().unwrap());
        for (host, origin, site, status) in [
            ("127.0.0.1:8787", "", "", 200),
            ("localhost:8787", "", "", 200),
            ("evil.example:8787", "", "", 403),
            ("127.0.0.1:80", "", "", 403),
            ("127.0.0.1:8787", "https://evil.example", "", 403),
            ("127.0.0.1:8787", "null", "", 403),
            ("127.0.0.1:8787", "", "cross-site", 403),
            (
                "127.0.0.1:8787",
                "http://127.0.0.1:8787",
                "same-origin",
                200,
            ),
            (
                "127.0.0.1:8787",
                "http://wails.localhost",
                "cross-site",
                200,
            ),
        ] {
            let request = axum::http::Request::builder()
                .uri("/healthz")
                .header("Host", host)
                .header("Origin", origin)
                .header("Sec-Fetch-Site", site)
                .body(axum::body::Body::empty())
                .unwrap();
            let response = router.clone().oneshot(request).await.unwrap();
            assert_eq!(response.status(), status, "{host} {origin} {site}");
            assert_eq!(response.headers()["x-content-type-options"], "nosniff");
        }
        let response = response(
            &router,
            "OPTIONS",
            "/auth/login",
            &[
                ("Origin", "http://wails.localhost"),
                ("Access-Control-Request-Method", "POST"),
                (
                    "Access-Control-Request-Headers",
                    "content-type, range, if-range, if-none-match",
                ),
            ],
            "",
        )
        .await;
        assert_eq!(response.status(), 204);
        assert_eq!(
            response.headers()["access-control-allow-origin"],
            "http://wails.localhost"
        );
        assert!(
            response.headers()["access-control-allow-headers"]
                .to_str()
                .unwrap()
                .contains("If-Range")
        );
    }

    #[test]
    fn assignment_queries_preserve_defaults_and_enforce_selector_limits() {
        for raw in [None, Some(""), Some("other=ignored")] {
            assert!(matches!(
                super::parse_assignment_query(raw).unwrap(),
                crate::operation::Request::Assignments {
                    courses,
                    policy: crate::model::SyncPolicy::Auto
                } if courses.is_empty()
            ));
        }
        for expected in [
            crate::model::SyncPolicy::Auto,
            crate::model::SyncPolicy::Always,
            crate::model::SyncPolicy::Never,
        ] {
            let policy = match expected {
                crate::model::SyncPolicy::Auto => "auto",
                crate::model::SyncPolicy::Always => "true",
                crate::model::SyncPolicy::Never => "false",
            };
            let query = format!("sync={policy}&courseId=first&courseId=second");
            let crate::operation::Request::Assignments {
                courses,
                policy: actual,
            } = super::parse_assignment_query(Some(&query)).unwrap()
            else {
                panic!("Expected an assignment request")
            };
            assert_eq!(actual, expected);
            assert_eq!(
                courses.iter().map(AsRef::as_ref).collect::<Vec<&str>>(),
                ["first", "second"]
            );
            let repeated = format!("sync={policy}&sync={policy}");
            assert!(super::parse_assignment_query(Some(&repeated)).is_err());
        }
        let query = std::iter::repeat_n("courseId=course", 500)
            .collect::<Vec<_>>()
            .join("&");
        assert!(super::parse_assignment_query(Some(&query)).is_ok());
        assert!(super::parse_assignment_query(Some(&format!("{query}&courseId=extra"))).is_err());
    }

    #[tokio::test]
    async fn selectors_and_request_bodies_fail_before_starting_work() {
        let fixture = crate::rpc::tests::Fixture::new().await;
        let operations = fixture.operations().await;
        let router = super::router(operations.clone(), "127.0.0.1:8787".parse().unwrap());
        for path in [
            "/courses?sync=",
            "/courses?sync=invalid",
            "/courses?sync=true&sync=false",
            "/assignments?courseId=",
            "/assignments?courseId=course1&courseId=",
            "/assignments?sync=invalid",
            "/assignments?sync=",
            "/materials/invalid",
            "/materials/invalid/resources/SRS1/file",
            "/materials/MAT1/resources/invalid/file",
            "/google-drive/files/invalid%21/file",
        ] {
            assert_eq!(
                response(&router, "GET", path, &[], "").await.status(),
                400,
                "{path}"
            );
        }
        for body in ["", "{", "{\"interactive\":\"yes\"}", "{\"other\":true}"] {
            assert_eq!(
                response(
                    &router,
                    "POST",
                    "/auth/login",
                    &[("Content-Type", "application/json")],
                    body
                )
                .await
                .status(),
                400
            );
        }
        for path in [
            "/auth/login",
            "/auth/google/login",
            "/auth/webauthn",
            "/google-drive/files/download",
        ] {
            let result = response(
                &router,
                "POST",
                path,
                &[("Content-Type", "application/json")],
                &" ".repeat(65537),
            )
            .await;
            assert_eq!(result.status(), 413, "{path}");
            let body: serde_json::Value = serde_json::from_slice(&bytes(result).await).unwrap();
            assert_eq!(body["error"]["reason"], "payload-too-large");
            validate_response("POST", path, 413, "application/json", &body);
        }
        let events = stream(&router, "GET", "/courses?sync=false", "").await;
        assert_eq!(
            events.last().unwrap().1["error"]["reason"],
            "archive-data-missing"
        );
        assert_eq!(
            fixture
                .service
                .courses_calls
                .load(std::sync::atomic::Ordering::SeqCst),
            0
        );
        operations.shutdown().await;
    }

    #[tokio::test]
    async fn disconnecting_only_detaches_observation_and_equivalent_work_is_shared() {
        let fixture = crate::rpc::tests::Fixture::new().await;
        let operations = fixture.operations().await;
        let router = super::router(operations.clone(), "127.0.0.1:8787".parse().unwrap());
        let initial = response(&router, "GET", "/courses?sync=true", &[], "").await;
        assert_eq!(initial.status(), 200);
        drop(initial);
        let events = stream(&router, "GET", "/courses?sync=true", "").await;
        assert_eq!(events.last().unwrap().0, "result");
        assert_eq!(
            fixture
                .service
                .courses_calls
                .load(std::sync::atomic::Ordering::SeqCst),
            1
        );
        let events = stream(&router, "GET", "/courses?sync=auto", "").await;
        assert_eq!(events.last().unwrap().0, "result");
        assert_eq!(
            fixture
                .service
                .courses_calls
                .load(std::sync::atomic::Ordering::SeqCst),
            1
        );
        operations.shutdown().await;
    }

    #[tokio::test]
    async fn files_support_head_ranges_and_conditional_requests() {
        let fixture = crate::rpc::tests::Fixture::new().await;
        let operations = fixture.operations().await;
        let router = super::router(operations.clone(), "127.0.0.1:8787".parse().unwrap());
        stream(
            &router,
            "POST",
            "/materials/MAT1/resources/SRS1/download",
            "",
        )
        .await;
        let metadata = operations
            .archive
            .saved_file(
                &"MAT1".to_owned().try_into().unwrap(),
                &"SRS1".to_owned().try_into().unwrap(),
            )
            .await
            .unwrap();
        operations
            .archive
            .replace_google_drive_saved_file(
                &"drive_file".to_owned().try_into().unwrap(),
                &metadata,
            )
            .await
            .unwrap();
        let prepared = response(
            &router,
            "POST",
            "/google-drive/files/drive_file/prepare",
            &[],
            "",
        )
        .await;
        assert_eq!(prepared.status(), 200);
        let prepared: serde_json::Value = serde_json::from_slice(&bytes(prepared).await).unwrap();
        validate_response(
            "POST",
            "/google-drive/files/drive_file/prepare",
            200,
            "application/json",
            &prepared,
        );
        assert_eq!(
            std::fs::read(prepared["data"]["path"].as_str().unwrap()).unwrap(),
            b"hello"
        );
        for path in [
            "/materials/MAT1/resources/SRS1/file",
            "/google-drive/files/drive_file/file",
        ] {
            let complete = response(&router, "GET", path, &[], "").await;
            assert_eq!(complete.status(), 200);
            let tag = complete.headers()["etag"].to_str().unwrap().to_owned();
            assert_eq!(bytes(complete).await, b"hello");
            let head = response(&router, "HEAD", path, &[], "").await;
            assert_eq!(head.status(), 200);
            assert_eq!(head.headers()["content-length"], "5");
            assert!(bytes(head).await.is_empty());
            let partial_head = response(&router, "HEAD", path, &[("Range", "bytes=1-3")], "").await;
            assert_eq!(partial_head.status(), 206);
            assert!(bytes(partial_head).await.is_empty());
            let unsatisfiable_head =
                response(&router, "HEAD", path, &[("Range", "bytes=99-")], "").await;
            assert_eq!(unsatisfiable_head.status(), 416);
            assert!(bytes(unsatisfiable_head).await.is_empty());
            let partial = response(&router, "GET", path, &[("Range", "bytes=1-3")], "").await;
            assert_eq!(partial.status(), 206);
            assert_eq!(partial.headers()["content-range"], "bytes 1-3/5");
            assert_eq!(bytes(partial).await, b"ell");
            assert_eq!(
                response(&router, "GET", path, &[("Range", "bytes=99-")], "")
                    .await
                    .status(),
                416
            );
            assert_eq!(
                response(
                    &router,
                    "GET",
                    path,
                    &[("If-None-Match", &format!("W/{tag}"))],
                    ""
                )
                .await
                .status(),
                304
            );
            let fresh = response(
                &router,
                "GET",
                path,
                &[("Range", "bytes=1-3"), ("If-Range", "\"old\"")],
                "",
            )
            .await;
            assert_eq!(fresh.status(), 200);
            assert_eq!(bytes(fresh).await, b"hello");
        }
        assert_eq!(
            response(&router, "GET", "/google-drive/files/SRS1/file", &[], "")
                .await
                .status(),
            404
        );
        assert_eq!(
            response(
                &router,
                "GET",
                "/materials/MAT1/resources/SRS2/file",
                &[],
                ""
            )
            .await
            .status(),
            404
        );
        operations.shutdown().await;
    }

    #[tokio::test]
    async fn google_drive_downloads_validate_urls_and_do_not_fetch_lms_data() {
        let fixture = crate::rpc::tests::Fixture::new().await;
        fixture
            .service
            .google_authentication_required
            .store(true, std::sync::atomic::Ordering::SeqCst);
        let operations = fixture.operations().await;
        let router = super::router(operations.clone(), "127.0.0.1:8787".parse().unwrap());
        for body in [
            "{}",
            "{\"url\":\"https://example.com/file\"}",
            "{\"url\":\"https://drive.google.com/drive/folders/folder\"}",
        ] {
            assert_eq!(
                response(
                    &router,
                    "POST",
                    "/google-drive/files/download",
                    &[("Content-Type", "application/json")],
                    body
                )
                .await
                .status(),
                400
            );
        }
        let events = stream(
            &router,
            "POST",
            "/google-drive/files/download",
            "{\"url\":\"https://drive.google.com/file/d/drive_file/view\"}",
        )
        .await;
        assert_eq!(events.last().unwrap().0, "error");
        assert_eq!(
            events.last().unwrap().1["error"]["reason"],
            "authentication-required"
        );
        assert!(matches!(
            operations
                .archive
                .material_detail(&"MAT1".to_owned().try_into().unwrap())
                .await,
            Err(crate::archive::Error::Missing)
        ));
        assert!(matches!(
            operations
                .archive
                .google_drive_saved_file(&"drive_file".to_owned().try_into().unwrap())
                .await,
            Err(crate::archive::Error::Missing)
        ));
        operations.shutdown().await;
    }

    #[tokio::test]
    async fn failed_transfers_keep_retrieved_metadata_without_publishing_file_references() {
        let fixture = crate::rpc::tests::Fixture::new().await;
        fixture
            .service
            .truncated
            .store(true, std::sync::atomic::Ordering::SeqCst);
        let operations = fixture.operations().await;
        let router = super::router(operations.clone(), "127.0.0.1:8787".parse().unwrap());
        let events = stream(
            &router,
            "POST",
            "/materials/MAT1/resources/SRS1/download",
            "",
        )
        .await;
        assert_eq!(events.last().unwrap().0, "error");
        let detail = operations
            .archive
            .material_detail(&"MAT1".to_owned().try_into().unwrap())
            .await
            .unwrap();
        assert_eq!(detail.resources.len(), 1);
        assert!(detail.resources[0].saved_file.is_none());
        operations.shutdown().await;
    }

    #[tokio::test]
    async fn timeouts_terminate_observation_without_persisting_incomplete_work() {
        let fixture = crate::rpc::tests::Fixture::new().await;
        let operations = std::sync::Arc::new(crate::operation::Coordinator::new(
            crate::archive::Store::open("sqlite::memory:")
                .await
                .unwrap(),
            crate::files::Store::new(
                fixture.temporary.path().join("resources"),
                fixture.temporary.path(),
            )
            .unwrap(),
            fixture.browser_worker.clone(),
            fixture.user_browser.clone(),
            crate::operation::Options {
                temporary_directory: fixture.temporary.path().to_path_buf(),
                job_timeout: std::time::Duration::from_millis(1),
                course_concurrency: std::num::NonZeroUsize::new(4).unwrap(),
            },
        ));
        let router = super::router(operations.clone(), "127.0.0.1:8787".parse().unwrap());
        let events = stream(&router, "GET", "/courses?sync=true", "").await;
        assert_eq!(events.last().unwrap().1["error"]["reason"], "timeout");
        assert!(matches!(
            operations.archive.courses().await,
            Err(crate::archive::Error::Missing)
        ));
        operations.shutdown().await;
    }

    #[tokio::test]
    async fn assignments_deduplicate_history_and_synchronize_only_the_selected_lms_year() {
        let fixture = crate::rpc::tests::Fixture::new().await;
        let operations = fixture.operations().await;
        let make_course = |id: &str, year: i32| crate::model::Course {
            name: id.into(),
            academic_year: year.try_into().unwrap(),
            access: crate::model::Access::Available {
                id: id.to_owned().try_into().unwrap(),
            },
            schedule: crate::model::Schedule::Other,
            archived: false,
        };
        let material = crate::model::Material {
            id: "REP1".to_owned().try_into().unwrap(),
            name: "Report".into(),
            kind: crate::model::MaterialKind::Report {
                status: crate::model::ReportStatus::Unsubmitted,
            },
            deadline: crate::model::Deadline::Unlisted,
            material_link_available: true,
            retrieved_at: None,
            archived: false,
        };
        operations
            .archive
            .append(crate::model::Snapshot {
                courses: Some(crate::model::CourseListing {
                    academic_year: 2025.try_into().unwrap(),
                    entries: vec![make_course("course1", 2025), make_course("course2", 2025)],
                }),
                materials: Some(crate::model::CourseMaterials {
                    course_id: "course1".to_owned().try_into().unwrap(),
                    folders: vec![crate::model::Folder {
                        name: "Week 1".into(),
                        class_date: None,
                        description_html: None,
                        materials: vec![material],
                    }],
                }),
                contents: None,
            })
            .await
            .unwrap();
        operations
            .archive
            .append(crate::model::Snapshot {
                courses: Some(crate::model::CourseListing {
                    academic_year: 2026.try_into().unwrap(),
                    entries: vec![make_course("course1", 2026)],
                }),
                materials: None,
                contents: None,
            })
            .await
            .unwrap();
        let router = super::router(operations.clone(), "127.0.0.1:8787".parse().unwrap());
        let events = stream(&router, "GET", "/assignments?sync=false", "").await;
        assert_eq!(
            events.last().unwrap().1["data"]["assignments"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
        let events = stream(&router, "GET", "/assignments?sync=true", "").await;
        assert_eq!(events.last().unwrap().0, "result");
        assert!(
            events.last().unwrap().1["data"]["failures"]
                .as_array()
                .unwrap()
                .is_empty()
        );
        operations.shutdown().await;
    }
}
