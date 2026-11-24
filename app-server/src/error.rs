#[derive(
    Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize, utoipa::ToSchema,
)]
#[serde(rename_all = "kebab-case")]
pub enum Reason {
    InvalidInput,
    PayloadTooLarge,
    Conflict,
    AuthenticationRequired,
    ArchiveDataMissing,
    MaterialNotFound,
    ResourceNotFound,
    CourseNotFound,
    UnsupportedResource,
    Source,
    Timeout,
    Internal,
    Archive,
    AuthenticationStorage,
    ResourceStorage,
    NotFound,
    Forbidden,
    BrowserStart,
}

#[derive(Clone, Debug, serde::Serialize, utoipa::ToSchema)]
pub struct Public {
    pub reason: Reason,
    pub message: String,
}

impl Public {
    pub(crate) fn internal(reason: Reason) -> Self {
        Self {
            reason,
            message: "The operation failed. Check the server log.".into(),
        }
    }
}

impl From<&crate::archive::Error> for Public {
    fn from(error: &crate::archive::Error) -> Self {
        match error {
            crate::archive::Error::Missing => Self {
                reason: Reason::ArchiveDataMissing,
                message: error.to_string(),
            },
            _ => Self::internal(Reason::Archive),
        }
    }
}

impl From<&crate::files::Error> for Public {
    fn from(error: &crate::files::Error) -> Self {
        match error {
            crate::files::Error::Missing => Self {
                reason: Reason::ArchiveDataMissing,
                message: error.to_string(),
            },
            _ => Self::internal(Reason::ResourceStorage),
        }
    }
}

impl From<&crate::browser_worker::Error> for Public {
    fn from(error: &crate::browser_worker::Error) -> Self {
        let reason = match error {
            crate::browser_worker::Error::AuthenticationRequired => {
                return Self {
                    reason: Reason::AuthenticationRequired,
                    message: "Authentication is required".into(),
                };
            }
            crate::browser_worker::Error::Rpc { source }
                if source.code() == tonic::Code::DeadlineExceeded =>
            {
                return Self {
                    reason: Reason::Timeout,
                    message: "The browser request timed out".into(),
                };
            }
            crate::browser_worker::Error::AuthenticationStorage { .. } => {
                Reason::AuthenticationStorage
            }
            crate::browser_worker::Error::BrowserStart { .. } => Reason::BrowserStart,
            crate::browser_worker::Error::CourseNotFound { .. } => Reason::CourseNotFound,
            crate::browser_worker::Error::MaterialNotFound { .. } => Reason::MaterialNotFound,
            crate::browser_worker::Error::ResourceNotFound { .. } => Reason::ResourceNotFound,
            crate::browser_worker::Error::UnsupportedResource { .. } => Reason::UnsupportedResource,
            crate::browser_worker::Error::Source { .. } => Reason::Source,
            crate::browser_worker::Error::Forbidden { .. } => Reason::Forbidden,
            crate::browser_worker::Error::InvalidResponse { .. } => {
                return Self {
                    reason: Reason::Source,
                    message: "The browser returned an invalid response".into(),
                };
            }
            crate::browser_worker::Error::Rpc { .. } => {
                return Self {
                    reason: Reason::Source,
                    message: "Browser worker RPC failed".into(),
                };
            }
            crate::browser_worker::Error::DownloadStorage(_) => {
                return Self::internal(Reason::ResourceStorage);
            }
        };
        Self {
            reason,
            message: error.to_string(),
        }
    }
}

#[test]
fn invalid_values_are_classified_by_their_source() {
    let browser =
        crate::browser_worker::Error::from(crate::model::InvalidValue { field: "course ID" });
    let archive = crate::archive::Error::from(crate::model::InvalidValue { field: "course ID" });
    assert!(matches!(
        &browser,
        crate::browser_worker::Error::InvalidResponse {
            field: "course ID",
            details: serde_json::Value::Null,
            ..
        }
    ));
    assert!(
        std::error::Error::source(&browser)
            .unwrap()
            .is::<crate::model::InvalidValue>()
    );
    assert_eq!(Public::from(&browser).reason, Reason::Source);
    assert_eq!(Public::from(&archive).reason, Reason::Archive);
}

impl From<&crate::user_browser::Error> for Public {
    fn from(error: &crate::user_browser::Error) -> Self {
        let reason = match error {
            crate::user_browser::Error::AuthenticationRequired(provider) => {
                return Self {
                    reason: Reason::AuthenticationRequired,
                    message: match provider {
                        crate::user_browser::Provider::Lms => "Authentication is required".into(),
                        crate::user_browser::Provider::Google => {
                            "Google authentication is required".into()
                        }
                    },
                };
            }
            crate::user_browser::Error::Rpc { source }
                if source.code() == tonic::Code::DeadlineExceeded =>
            {
                return Self {
                    reason: Reason::Timeout,
                    message: "The browser request timed out".into(),
                };
            }
            crate::user_browser::Error::AuthenticationStorage { .. } => {
                Reason::AuthenticationStorage
            }
            crate::user_browser::Error::BrowserStart { .. } => Reason::BrowserStart,
            crate::user_browser::Error::Source { .. } => Reason::Source,
            crate::user_browser::Error::Conflict { .. } => Reason::Conflict,
            crate::user_browser::Error::InvalidResponse { .. } => {
                return Self {
                    reason: Reason::Source,
                    message: "The browser returned an invalid response".into(),
                };
            }
            crate::user_browser::Error::Rpc { .. } => {
                return Self {
                    reason: Reason::Source,
                    message: "User browser RPC failed".into(),
                };
            }
        };
        Self {
            reason,
            message: error.to_string(),
        }
    }
}

#[test]
fn storage_and_rpc_diagnostics_are_not_exposed() {
    let archive =
        crate::archive::Error::Database(sea_orm::DbErr::Custom("private database path".into()));
    let files = crate::files::Error::Io(std::io::Error::other("private resource path"));
    let browser = crate::user_browser::Error::Rpc {
        source: tonic::Status::internal("private browser details").into(),
    };
    let response = crate::browser_worker::Error::InvalidResponse {
        field: "failure",
        details: serde_json::json!({ "message": "private failure details" }),
        source: None,
    };
    for public in [
        Public::from(&archive),
        Public::from(&files),
        Public::from(&browser),
        Public::from(&response),
    ] {
        assert!(!public.message.contains("private"));
    }
    assert_eq!(Public::from(&archive).reason, Reason::Archive);
    assert_eq!(Public::from(&files).reason, Reason::ResourceStorage);
    assert_eq!(Public::from(&browser).reason, Reason::Source);
}

impl From<&crate::drive::Error> for Public {
    fn from(error: &crate::drive::Error) -> Self {
        match error {
            crate::drive::Error::Download(error) => error.into(),
            crate::drive::Error::Storage(_) => Self::internal(Reason::ResourceStorage),
            crate::drive::Error::Client(_) | crate::drive::Error::Stream(_) => Self {
                reason: Reason::Source,
                message: "Could not download the Google Drive file".into(),
            },
        }
    }
}

#[test]
fn download_errors_preserve_sources_without_exposing_diagnostics() {
    let storage = crate::drive::Error::Storage(std::io::Error::other("private temporary path"));
    let request = crate::drive::Error::Client(
        reqwest::Client::new()
            .get("http://[private")
            .build()
            .unwrap_err(),
    );
    assert!(matches!(&storage, crate::drive::Error::Storage(_)));
    assert!(matches!(&request, crate::drive::Error::Client(_)));
    assert!(
        std::error::Error::source(&storage)
            .unwrap()
            .is::<std::io::Error>()
    );
    assert!(
        std::error::Error::source(&request)
            .unwrap()
            .is::<reqwest::Error>()
    );
    assert_eq!(Public::from(&storage).reason, Reason::ResourceStorage);
    assert_eq!(Public::from(&request).reason, Reason::Source);
    assert!(storage.to_string().contains("private"));
    for error in [storage, request] {
        assert!(!Public::from(&error).message.contains("private"));
    }
}

#[test]
fn drive_stream_failures_preserve_their_source_without_exposing_details() {
    for error in [
        google_drive::download::StreamError::SizeMismatch {
            expected: 6,
            received: 5,
        },
        google_drive::download::StreamError::Request(
            reqwest::Client::new()
                .get("http://[private")
                .build()
                .unwrap_err(),
        ),
    ] {
        let error = crate::drive::Error::from(error);
        let public = Public::from(&error);
        assert_eq!(public.reason, Reason::Source);
        assert_eq!(public.message, "Could not download the Google Drive file");
        assert!(!public.message.contains("private"));
        assert!(matches!(error, crate::drive::Error::Stream(_)));
        if let crate::drive::Error::Stream(google_drive::download::StreamError::Request(_)) = &error
        {
            assert!(
                std::error::Error::source(&error)
                    .unwrap()
                    .is::<reqwest::Error>()
            );
        }
    }
}

impl From<&google_drive::download::Error> for Public {
    fn from(error: &google_drive::download::Error) -> Self {
        match error {
            google_drive::download::Error::Request(
                google_drive::RequestError::AuthenticationRequired,
            ) => Self {
                reason: Reason::AuthenticationRequired,
                message: "Google authentication is required".into(),
            },
            google_drive::download::Error::Request(google_drive::RequestError::AccessDenied) => {
                Self {
                    reason: Reason::Forbidden,
                    message: error.to_string(),
                }
            }
            google_drive::download::Error::NotDownloadable => Self {
                reason: Reason::UnsupportedResource,
                message: error.to_string(),
            },
            _ => Self {
                reason: Reason::Source,
                message: "Could not download the Google Drive file".into(),
            },
        }
    }
}

#[test]
fn drive_errors_keep_public_classifications_without_exposing_details() {
    let denied = crate::drive::Error::from(google_drive::download::Error::Request(
        google_drive::RequestError::AccessDenied,
    ));
    let unsupported = crate::drive::Error::from(google_drive::download::Error::NotDownloadable);
    let invalid = crate::drive::Error::from(google_drive::download::Error::Request(
        google_drive::RequestError::InvalidResponse {
            reason: "private response details",
            source: Some(Box::new(std::io::Error::other("private source"))),
        },
    ));
    assert_eq!(Public::from(&denied).reason, Reason::Forbidden);
    assert_eq!(
        Public::from(&denied).message,
        "Google Drive denied access to the file"
    );
    assert_eq!(
        Public::from(&unsupported).reason,
        Reason::UnsupportedResource
    );
    assert_eq!(
        Public::from(&unsupported).message,
        "Google Drive did not return a downloadable file"
    );
    assert_eq!(Public::from(&invalid).reason, Reason::Source);
    assert_eq!(
        Public::from(&invalid).message,
        "Could not download the Google Drive file"
    );
}

impl From<&crate::operation::Error> for Public {
    fn from(error: &crate::operation::Error) -> Self {
        match error {
            crate::operation::Error::Archive(error) => error.into(),
            crate::operation::Error::BrowserWorker(error) => error.into(),
            crate::operation::Error::UserBrowser(error) => error.into(),
            crate::operation::Error::Drive(error) => error.into(),
            crate::operation::Error::Files(error) => error.into(),
            crate::operation::Error::Timeout => Self {
                reason: Reason::Timeout,
                message: error.to_string(),
            },
            crate::operation::Error::InvalidSnapshot(_)
            | crate::operation::Error::Serialization(_)
            | crate::operation::Error::Task(_) => Self::internal(Reason::Internal),
        }
    }
}
