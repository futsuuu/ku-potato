pub mod protocol {
    tonic::include_proto!("kupotato.userbrowser.v1");
}
mod cookies;

use prost::Message as _;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("Authentication is required for {0:?}")]
    AuthenticationRequired(Provider),
    #[error("{message}")]
    AuthenticationStorage { message: String },
    #[error("{message}")]
    BrowserStart { message: String },
    #[error("{message}")]
    Source { message: String },
    #[error("{message}")]
    Conflict { message: String },
    #[error("Invalid user browser response for {field}: {details}")]
    InvalidResponse {
        field: &'static str,
        details: serde_json::Value,
        #[source]
        source: Option<Box<dyn std::error::Error + Send + Sync>>,
    },
    #[error("User browser RPC failed: {source}")]
    Rpc {
        #[source]
        source: Box<tonic::Status>,
    },
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

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Provider {
    KogakuinSso,
    Google,
}

impl Provider {
    fn wire(self) -> i32 {
        match self {
            Self::KogakuinSso => protocol::Provider::KogakuinSso.into(),
            Self::Google => protocol::Provider::Google.into(),
        }
    }
}

#[test]
fn providers_map_to_distinct_protocol_values() {
    assert_eq!(
        Provider::KogakuinSso.wire(),
        i32::from(protocol::Provider::KogakuinSso)
    );
    assert_eq!(
        Provider::Google.wire(),
        i32::from(protocol::Provider::Google)
    );
    assert_ne!(Provider::KogakuinSso.wire(), Provider::Google.wire());
}

#[derive(Clone)]
pub struct Client {
    inner: protocol::user_browser_client::UserBrowserClient<
        tonic::service::interceptor::InterceptedService<
            tonic::transport::Channel,
            crate::rpc::Token,
        >,
    >,
}

impl Client {
    pub fn new(connection: crate::rpc::Connection) -> Self {
        Self {
            inner: protocol::user_browser_client::UserBrowserClient::with_interceptor(
                connection.channel,
                connection.token,
            ),
        }
    }

    #[tracing::instrument(skip_all)]
    pub async fn sso_cookies(&self, renew: bool) -> Result<Vec<protocol::Cookie>, Error> {
        let cookies = self
            .inner
            .clone()
            .sso_cookies(protocol::SsoCookiesRequest { renew })
            .await
            .map_err(|status| map_status(status, Provider::KogakuinSso))?
            .into_inner()
            .cookies;
        for cookie in &cookies {
            cookies::validate_cookie(cookie)?;
        }
        Ok(cookies)
    }

    #[tracing::instrument(skip_all)]
    pub async fn login(&self, provider: Provider, interactive: bool) -> Result<(), Error> {
        self.inner
            .clone()
            .login(protocol::LoginRequest {
                provider: provider.wire(),
                interactive,
            })
            .await
            .map_err(|status| map_status(status, provider))?;
        Ok(())
    }

    #[tracing::instrument(skip_all)]
    pub async fn authentication_status(
        &self,
        provider: Provider,
    ) -> Result<crate::model::Authentication, Error> {
        let response = self
            .inner
            .clone()
            .status(protocol::ProviderRequest {
                provider: provider.wire(),
            })
            .await
            .map_err(|status| map_status(status, provider))?
            .into_inner();
        Ok(if response.authenticated {
            crate::model::Authentication::Authenticated
        } else {
            crate::model::Authentication::Unauthenticated
        })
    }

    #[tracing::instrument(skip_all)]
    pub async fn is_web_authn_credential_registered(&self) -> Result<bool, Error> {
        Ok(self
            .inner
            .clone()
            .web_authn_registration_status(())
            .await
            .map_err(|status| map_status(status, Provider::KogakuinSso))?
            .into_inner()
            .registered)
    }

    #[tracing::instrument(skip_all)]
    pub async fn register_web_authn_credential(&self, interactive: bool) -> Result<(), Error> {
        self.inner
            .clone()
            .register_web_authn(protocol::InteractiveRequest { interactive })
            .await
            .map_err(|status| map_status(status, Provider::KogakuinSso))?;
        Ok(())
    }

    #[tracing::instrument(skip_all)]
    pub async fn delete_web_authn_credential(&self) -> Result<(), Error> {
        self.inner
            .clone()
            .delete_web_authn(())
            .await
            .map_err(|status| map_status(status, Provider::KogakuinSso))?;
        Ok(())
    }

    #[tracing::instrument(skip_all)]
    pub async fn google_cookies(&self) -> Result<reqwest_cookie_store::CookieStoreMutex, Error> {
        cookies::create_cookie_store(
            self.inner
                .clone()
                .google_cookies(())
                .await
                .map_err(|status| map_status(status, Provider::Google))?
                .into_inner()
                .cookies,
        )
    }
}

#[tokio::test]
async fn google_cookie_failures_preserve_the_authentication_provider() {
    let fixture = crate::rpc::tests::Fixture::new().await;
    use reqwest::cookie::CookieStore as _;
    let cookies = fixture.user_browser.google_cookies().await.unwrap();
    assert!(
        cookies
            .cookies(&url::Url::parse("https://drive.google.com/").unwrap())
            .is_none()
    );
    fixture
        .service
        .google_authentication_required
        .store(true, std::sync::atomic::Ordering::SeqCst);
    assert!(matches!(
        fixture.user_browser.google_cookies().await,
        Err(Error::AuthenticationRequired(Provider::Google))
    ));
}

fn map_status(status: tonic::Status, provider: Provider) -> Error {
    if status.code() == tonic::Code::FailedPrecondition
        && let Ok(details) = crate::rpc::Status::decode(status.details())
    {
        for detail in details.details {
            if detail.type_url == "type.googleapis.com/kupotato.userbrowser.v1.Failure"
                && let Ok(failure) = protocol::Failure::decode(detail.value.as_slice())
            {
                return match protocol::FailureReason::try_from(failure.reason) {
                    Ok(protocol::FailureReason::AuthenticationRequired) => {
                        Error::AuthenticationRequired(provider)
                    }
                    Ok(protocol::FailureReason::AuthenticationStorage) => {
                        Error::AuthenticationStorage {
                            message: failure.message,
                        }
                    }
                    Ok(protocol::FailureReason::BrowserStart) => Error::BrowserStart {
                        message: failure.message,
                    },
                    Ok(protocol::FailureReason::Source) => Error::Source {
                        message: failure.message,
                    },
                    Ok(protocol::FailureReason::Conflict) => Error::Conflict {
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
        source: status.into(),
    }
}

#[test]
fn rpc_authentication_requires_typed_details_and_preserves_the_provider() {
    let failure = protocol::Failure {
        reason: protocol::FailureReason::AuthenticationRequired.into(),
        message: "Login required".into(),
    };
    let details = crate::rpc::Status {
        code: tonic::Code::FailedPrecondition as i32,
        message: failure.message.clone(),
        details: vec![prost_types::Any {
            type_url: "type.googleapis.com/kupotato.userbrowser.v1.Failure".into(),
            value: failure.encode_to_vec(),
        }],
    }
    .encode_to_vec();
    for provider in [Provider::KogakuinSso, Provider::Google] {
        let status = tonic::Status::with_details(
            tonic::Code::FailedPrecondition,
            "Login required",
            details.clone().into(),
        );
        assert!(matches!(
            map_status(status, provider),
            Error::AuthenticationRequired(actual) if actual == provider
        ));
        assert!(matches!(
            map_status(tonic::Status::unauthenticated("Login required"), provider),
            Error::Rpc { .. }
        ));
    }
}

#[test]
fn user_browser_failures_preserve_public_reasons_and_messages() {
    for reason in [
        protocol::FailureReason::AuthenticationStorage,
        protocol::FailureReason::BrowserStart,
        protocol::FailureReason::Source,
        protocol::FailureReason::Conflict,
    ] {
        let failure = protocol::Failure {
            reason: reason.into(),
            message: "User browser rejected the request".into(),
        };
        let details = crate::rpc::Status {
            code: tonic::Code::FailedPrecondition as i32,
            message: failure.message.clone(),
            details: vec![prost_types::Any {
                type_url: "type.googleapis.com/kupotato.userbrowser.v1.Failure".into(),
                value: failure.encode_to_vec(),
            }],
        }
        .encode_to_vec();
        let error = map_status(
            tonic::Status::with_details(
                tonic::Code::FailedPrecondition,
                failure.message,
                details.into(),
            ),
            Provider::KogakuinSso,
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

#[test]
fn rpc_status_codes_take_precedence_over_failure_details() {
    let failure = protocol::Failure {
        reason: protocol::FailureReason::AuthenticationRequired.into(),
        message: "Login required".into(),
    };
    let details = crate::rpc::Status {
        code: tonic::Code::FailedPrecondition as i32,
        message: failure.message.clone(),
        details: vec![prost_types::Any {
            type_url: "type.googleapis.com/kupotato.userbrowser.v1.Failure".into(),
            value: failure.encode_to_vec(),
        }],
    }
    .encode_to_vec();
    for code in [
        tonic::Code::Cancelled,
        tonic::Code::DeadlineExceeded,
        tonic::Code::Unavailable,
        tonic::Code::Internal,
        tonic::Code::Unauthenticated,
    ] {
        let status =
            tonic::Status::with_details(code, "private diagnostics", details.clone().into());
        let error = map_status(status, Provider::Google);
        assert!(matches!(
            error,
            Error::Rpc { source }
                if source.code() == code && source.message() == "private diagnostics"
        ));
    }
}

#[test]
fn request_timeouts_preserve_the_rpc_status() {
    let error = map_status(
        tonic::Status::deadline_exceeded("User browser deadline"),
        Provider::Google,
    );
    assert!(matches!(
        &error,
        Error::Rpc { source }
            if source.code() == tonic::Code::DeadlineExceeded
                && source.message() == "User browser deadline"
    ));
    let public = crate::error::Public::from(&error);
    assert_eq!(public.reason, crate::error::Reason::Timeout);
    assert_eq!(public.message, "The browser request timed out");
}
