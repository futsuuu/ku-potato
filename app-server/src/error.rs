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

impl From<&crate::browser::Error> for Public {
    fn from(error: &crate::browser::Error) -> Self {
        let reason = match error {
            crate::browser::Error::AuthenticationRequired(provider) => {
                return Self {
                    reason: Reason::AuthenticationRequired,
                    message: match provider {
                        crate::browser::Provider::Lms => "Authentication is required".into(),
                        crate::browser::Provider::Google => {
                            "Google authentication is required".into()
                        }
                    },
                };
            }
            crate::browser::Error::Rpc { source, .. }
                if source.code() == tonic::Code::DeadlineExceeded =>
            {
                return Self {
                    reason: Reason::Timeout,
                    message: "The browser request timed out".into(),
                };
            }
            crate::browser::Error::AuthenticationStorage { .. } => Reason::AuthenticationStorage,
            crate::browser::Error::BrowserStart { .. } => Reason::BrowserStart,
            crate::browser::Error::CourseNotFound { .. } => Reason::CourseNotFound,
            crate::browser::Error::MaterialNotFound { .. } => Reason::MaterialNotFound,
            crate::browser::Error::ResourceNotFound { .. } => Reason::ResourceNotFound,
            crate::browser::Error::UnsupportedResource { .. } => Reason::UnsupportedResource,
            crate::browser::Error::Source { .. } => Reason::Source,
            crate::browser::Error::Forbidden { .. } => Reason::Forbidden,
            crate::browser::Error::Conflict { .. } => Reason::Conflict,
            crate::browser::Error::InvalidResponse { .. } => {
                return Self {
                    reason: Reason::Source,
                    message: "The browser returned an invalid response".into(),
                };
            }
            crate::browser::Error::Drive(error) => return error.into(),
            crate::browser::Error::Rpc { service, .. } => {
                return Self {
                    reason: Reason::Source,
                    message: match service {
                        crate::browser::process::Service::BrowserWorker => {
                            "Browser worker RPC failed".into()
                        }
                        crate::browser::process::Service::UserBrowser => {
                            "User browser RPC failed".into()
                        }
                    },
                };
            }
            crate::browser::Error::DriveRequest(_) | crate::browser::Error::DriveStream(_) => {
                return Self {
                    reason: Reason::Source,
                    message: "Could not download the Google Drive file".into(),
                };
            }
            crate::browser::Error::DownloadStorage(_) => {
                return Self::internal(Reason::ResourceStorage);
            }
        };
        Self {
            reason,
            message: error.to_string(),
        }
    }
}

impl From<&google_drive::download::Error> for Public {
    fn from(error: &google_drive::download::Error) -> Self {
        match error {
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

impl From<&crate::operation::Error> for Public {
    fn from(error: &crate::operation::Error) -> Self {
        match error {
            crate::operation::Error::Archive(error) => error.into(),
            crate::operation::Error::Browser(error) => error.into(),
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

#[cfg(test)]
mod tests {
    #[test]
    fn invalid_values_are_classified_by_their_source() {
        let browser =
            crate::browser::Error::from(crate::model::InvalidValue { field: "course ID" });
        let archive =
            crate::archive::Error::from(crate::model::InvalidValue { field: "course ID" });
        assert!(matches!(
            &browser,
            crate::browser::Error::InvalidResponse {
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
        assert_eq!(super::Public::from(&browser).reason, super::Reason::Source);
        assert_eq!(super::Public::from(&archive).reason, super::Reason::Archive);
    }

    #[test]
    fn download_errors_preserve_sources_without_exposing_diagnostics() {
        let storage =
            crate::browser::Error::DownloadStorage(std::io::Error::other("private temporary path"));
        let request = crate::browser::Error::DriveRequest(
            reqwest::Client::new()
                .get("http://[private")
                .build()
                .unwrap_err(),
        );
        assert!(matches!(
            &storage,
            crate::browser::Error::DownloadStorage(_)
        ));
        assert!(matches!(&request, crate::browser::Error::DriveRequest(_)));
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
        assert_eq!(
            super::Public::from(&storage).reason,
            super::Reason::ResourceStorage
        );
        assert_eq!(super::Public::from(&request).reason, super::Reason::Source);
        assert!(storage.to_string().contains("private"));
        for error in [storage, request] {
            assert!(!super::Public::from(&error).message.contains("private"));
        }
    }

    #[test]
    fn drive_errors_keep_public_classifications_without_exposing_details() {
        let denied = crate::browser::Error::from(google_drive::download::Error::Request(
            google_drive::RequestError::AccessDenied,
        ));
        let unsupported =
            crate::browser::Error::from(google_drive::download::Error::NotDownloadable);
        let invalid = crate::browser::Error::from(google_drive::download::Error::Request(
            google_drive::RequestError::InvalidResponse {
                reason: "private response details",
                source: Some(Box::new(std::io::Error::other("private source"))),
            },
        ));
        assert_eq!(
            super::Public::from(&denied).reason,
            super::Reason::Forbidden
        );
        assert_eq!(
            super::Public::from(&denied).message,
            "Google Drive denied access to the file"
        );
        assert_eq!(
            super::Public::from(&unsupported).reason,
            super::Reason::UnsupportedResource
        );
        assert_eq!(
            super::Public::from(&unsupported).message,
            "Google Drive did not return a downloadable file"
        );
        assert_eq!(super::Public::from(&invalid).reason, super::Reason::Source);
        assert_eq!(
            super::Public::from(&invalid).message,
            "Could not download the Google Drive file"
        );
    }

    #[test]
    fn storage_and_rpc_diagnostics_are_not_exposed() {
        let archive =
            crate::archive::Error::Database(sea_orm::DbErr::Custom("private database path".into()));
        let files = crate::files::Error::Io(std::io::Error::other("private resource path"));
        let browser = crate::browser::Error::Rpc {
            service: crate::browser::process::Service::UserBrowser,
            source: tonic::Status::internal("private browser details").into(),
        };
        let response = crate::browser::Error::InvalidResponse {
            field: "failure",
            details: serde_json::json!({ "message": "private failure details" }),
            source: None,
        };
        for public in [
            super::Public::from(&archive),
            super::Public::from(&files),
            super::Public::from(&browser),
            super::Public::from(&response),
        ] {
            assert!(!public.message.contains("private"));
        }
        assert_eq!(super::Public::from(&archive).reason, super::Reason::Archive);
        assert_eq!(
            super::Public::from(&files).reason,
            super::Reason::ResourceStorage
        );
        assert_eq!(super::Public::from(&browser).reason, super::Reason::Source);
    }
}
