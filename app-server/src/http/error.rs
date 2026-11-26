#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, utoipa::ToSchema)]
#[serde(rename_all = "kebab-case")]
#[schema(as = HttpErrorReason)]
pub enum Reason {
    InvalidInput,
    PayloadTooLarge,
    Forbidden,
    NotFound,
    ArchiveDataMissing,
    Archive,
    ResourceStorage,
    DependencyFailed,
    DependencyUnavailable,
    DependencyTimeout,
    Internal,
}

impl Reason {
    pub(super) fn status_code(self) -> axum::http::StatusCode {
        match self {
            Self::InvalidInput => axum::http::StatusCode::BAD_REQUEST,
            Self::PayloadTooLarge => axum::http::StatusCode::PAYLOAD_TOO_LARGE,
            Self::Forbidden => axum::http::StatusCode::FORBIDDEN,
            Self::NotFound | Self::ArchiveDataMissing => axum::http::StatusCode::NOT_FOUND,
            Self::Archive | Self::ResourceStorage | Self::Internal => {
                axum::http::StatusCode::INTERNAL_SERVER_ERROR
            }
            Self::DependencyFailed => axum::http::StatusCode::BAD_GATEWAY,
            Self::DependencyUnavailable => axum::http::StatusCode::SERVICE_UNAVAILABLE,
            Self::DependencyTimeout => axum::http::StatusCode::GATEWAY_TIMEOUT,
        }
    }
}

/// A failure to handle an HTTP request, not the outcome of a streamed operation.
#[derive(Debug, serde::Serialize, utoipa::ToSchema)]
#[schema(as = HttpError)]
pub struct Details {
    pub reason: Reason,
    pub message: String,
}

impl From<&super::Error> for Details {
    fn from(error: &super::Error) -> Self {
        let reason = match error {
            super::Error::InvalidInput(_) | super::Error::InvalidValue(_) => Reason::InvalidInput,
            super::Error::BodyTooLarge => Reason::PayloadTooLarge,
            super::Error::Forbidden => Reason::Forbidden,
            super::Error::NotFound => Reason::NotFound,
            super::Error::Archive(crate::archive::Error::Missing)
            | super::Error::Files(crate::files::Error::Missing) => Reason::ArchiveDataMissing,
            super::Error::Archive(_) => Reason::Archive,
            super::Error::Files(_) => Reason::ResourceStorage,
            super::Error::Header(_) => Reason::Internal,
            super::Error::WebAuthnState(error) => {
                let reason = match error {
                    crate::user_browser::Error::Rpc { source } => match source.code() {
                        tonic::Code::Unavailable => Reason::DependencyUnavailable,
                        tonic::Code::DeadlineExceeded => Reason::DependencyTimeout,
                        _ => Reason::DependencyFailed,
                    },
                    _ => Reason::DependencyFailed,
                };
                return Self {
                    reason,
                    message: match reason {
                        Reason::DependencyUnavailable => "The user browser service is unavailable",
                        Reason::DependencyTimeout => {
                            "Reading the saved WebAuthn credential state timed out"
                        }
                        _ => "Could not read the saved WebAuthn credential state",
                    }
                    .into(),
                };
            }
        };
        Self {
            reason,
            message: if reason.status_code().is_server_error() {
                "The request failed. Check the server log.".into()
            } else {
                error.to_string()
            },
        }
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn request_errors_have_transport_statuses_without_exposing_diagnostics() {
        struct Case {
            error: super::super::Error,
            status: u16,
            reason: super::Reason,
        }
        for case in [
            Case {
                error: super::super::Error::InvalidInput("Invalid query".into()),
                status: 400,
                reason: super::Reason::InvalidInput,
            },
            Case {
                error: super::super::Error::BodyTooLarge,
                status: 413,
                reason: super::Reason::PayloadTooLarge,
            },
            Case {
                error: super::super::Error::Forbidden,
                status: 403,
                reason: super::Reason::Forbidden,
            },
            Case {
                error: super::super::Error::NotFound,
                status: 404,
                reason: super::Reason::NotFound,
            },
            Case {
                error: super::super::Error::Archive(crate::archive::Error::Missing),
                status: 404,
                reason: super::Reason::ArchiveDataMissing,
            },
            Case {
                error: super::super::Error::Files(crate::files::Error::Missing),
                status: 404,
                reason: super::Reason::ArchiveDataMissing,
            },
            Case {
                error: super::super::Error::Archive(crate::archive::Error::Database(
                    sea_orm::DbErr::Custom("private database path".into()),
                )),
                status: 500,
                reason: super::Reason::Archive,
            },
            Case {
                error: super::super::Error::Files(crate::files::Error::Io(std::io::Error::other(
                    "private resource path",
                ))),
                status: 500,
                reason: super::Reason::ResourceStorage,
            },
            Case {
                error: super::super::Error::Header(
                    "\n".parse::<axum::http::HeaderValue>().unwrap_err(),
                ),
                status: 500,
                reason: super::Reason::Internal,
            },
        ] {
            let details = super::Details::from(&case.error);
            assert_eq!(details.reason, case.reason);
            assert_eq!(details.reason.status_code().as_u16(), case.status);
            assert!(!details.message.contains("private"));
        }
    }

    #[test]
    fn credential_state_failures_are_dependency_errors_not_operation_outcomes() {
        for error in [
            crate::user_browser::Error::AuthenticationRequired(
                crate::user_browser::Provider::KogakuinSso,
            ),
            crate::user_browser::Error::Conflict {
                message: "private conflict".into(),
            },
            crate::user_browser::Error::AuthenticationStorage {
                message: "private credential path".into(),
            },
            crate::user_browser::Error::InvalidResponse {
                field: "private response",
                details: serde_json::Value::Null,
                source: None,
            },
        ] {
            let details = super::Details::from(&super::super::Error::WebAuthnState(error));
            assert_eq!(details.reason, super::Reason::DependencyFailed);
            assert_eq!(details.reason.status_code().as_u16(), 502);
            assert!(!details.message.contains("private"));
        }
    }
}
