//! Google Drive HTTP client. No browser, database or filesystem access.
//!
//! Pass a caller-managed cookie store, which may be empty for public content.
//! Account 0 is used. A Google login redirect is reported as
//! `RequestError::AuthenticationRequired`; this client does not drive login.
//!
//! ```no_run
//! # async fn example() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
//! use futures_util::StreamExt as _;
//!
//! let cookies = std::sync::Arc::new(reqwest::cookie::Jar::default());
//! let client = google_drive::Client::new(cookies)?;
//! let url = url::Url::parse("https://drive.google.com/drive/folders/folder_id").unwrap();
//! let listing = client.list_folder(&url).await?;
//! for entry in listing.entries {
//!     if entry.kind == google_drive::folder::EntryKind::File {
//!         let download = client.download_file(&entry.url).await?;
//!         let stream = download.bytes_stream();
//!         futures_util::pin_mut!(stream);
//!         while let Some(chunk) = stream.next().await {
//!             let bytes = chunk?; // Pass to a caller-owned sink.
//!         }
//!     }
//! }
//! # Ok(())
//! # }
//! ```
use futures_util::StreamExt as _;

pub mod download;
pub mod folder;

/// Converts supported Drive, Docs and Colab file links to a download URL.
///
/// ```
/// let source = url::Url::parse("https://docs.google.com/document/d/abc_123/edit").unwrap();
/// let request_url = google_drive::download_url(&source).unwrap();
/// assert_eq!(request_url.as_str(), "https://drive.google.com/uc?id=abc_123&export=download&authuser=0");
/// let other = url::Url::parse("https://example.com/file").unwrap();
/// assert!(google_drive::download_url(&other).is_none());
/// ```
pub fn download_url(url: &url::Url) -> Option<url::Url> {
    if url.scheme() != "https"
        || url.port().is_some()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return None;
    }
    let parts: Vec<_> = url.path().trim_matches('/').split('/').collect();
    let id = match (url.host_str()?, parts.as_slice()) {
        ("drive.google.com", ["file", "d", id, ..]) => (*id).to_owned(),
        ("drive.google.com", ["open" | "uc" | "download"]) => url
            .query_pairs()
            .find(|(key, _)| key == "id")?
            .1
            .into_owned(),
        ("docs.google.com", ["document" | "presentation" | "spreadsheets", "d", id, ..])
            if *id != "e" =>
        {
            (*id).to_owned()
        }
        (
            "docs.google.com",
            [
                "document" | "presentation" | "spreadsheets",
                "u",
                _,
                "d",
                id,
                ..,
            ],
        ) => (*id).to_owned(),
        ("colab.research.google.com", ["drive", id, ..]) => (*id).to_owned(),
        _ => return None,
    };
    if id.is_empty()
        || id.len() > 256
        || !id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"_-".contains(&byte))
    {
        return None;
    }
    let mut request_url = url::Url::parse("https://drive.google.com/uc").ok()?;
    request_url
        .query_pairs_mut()
        .append_pair("id", &id)
        .append_pair("export", "download")
        .append_pair("authuser", "0");
    if let Some((_, key)) = url.query_pairs().find(|(name, _)| name == "resourcekey") {
        request_url
            .query_pairs_mut()
            .append_pair("resourcekey", &key);
    }
    Some(request_url)
}

#[test]
fn supported_links_become_canonical_download_destinations() {
    for input in [
        "https://drive.google.com/file/d/abc_123/view",
        "https://drive.google.com/open?id=abc_123",
        "https://drive.google.com/uc?id=abc_123&export=download",
        "https://docs.google.com/document/d/abc_123/edit",
        "https://docs.google.com/presentation/u/0/d/abc_123/edit",
        "https://docs.google.com/spreadsheets/d/abc_123/edit",
        "https://colab.research.google.com/drive/abc_123",
    ] {
        let url = crate::download_url(&url::Url::parse(input).unwrap()).unwrap();
        assert_eq!(url.host_str(), Some("drive.google.com"));
        assert_eq!(url.path(), "/uc");
        assert!(
            url.query_pairs()
                .any(|(key, value)| key == "id" && value == "abc_123")
        );
    }
    let url = crate::download_url(
        &url::Url::parse("https://drive.google.com/file/d/abc/view?resourcekey=secret").unwrap(),
    )
    .unwrap();
    assert!(
        url.query_pairs()
            .any(|(key, value)| key == "resourcekey" && value == "secret")
    );
}

#[test]
fn other_links_are_not_fetched() {
    for input in [
        "http://drive.google.com/file/d/id/view",
        "https://drive.google.com.evil.example/file/d/id/view",
        "https://drive.google.com:444/file/d/id/view",
        "https://drive.google.com/open?id=../secret",
        "https://docs.google.com/document/d/e/published/view",
        "https://example.com/file",
    ] {
        assert!(
            crate::download_url(&url::Url::parse(input).unwrap()).is_none(),
            "{input}"
        );
    }
}

fn is_allowed_download_url(url: &url::Url) -> bool {
    url.scheme() == "https"
        && url.port().is_none()
        && url.username().is_empty()
        && url.password().is_none()
        && url.host_str().is_some_and(|host| {
            host == "drive.google.com"
                || host == "drive.usercontent.google.com"
                || host == "googleusercontent.com"
                || host.ends_with(".googleusercontent.com")
        })
}

#[test]
fn redirect_destinations_are_restricted() {
    for url in [
        "http://drive.google.com/uc",
        "https://drive.google.com.evil.example/uc",
        "https://user@drive.google.com/uc",
        "https://drive.google.com:444/uc",
        "https://example.com/",
    ] {
        assert!(!is_allowed_download_url(&url::Url::parse(url).unwrap()));
    }
    for url in [
        "https://drive.google.com/uc",
        "https://drive.usercontent.google.com/download",
        "https://abc.googleusercontent.com/download",
    ] {
        assert!(is_allowed_download_url(&url::Url::parse(url).unwrap()));
    }
}

/// Failures shared by HTTP requests and response validation.
#[derive(Debug, thiserror::Error)]
pub enum RequestError {
    #[error("Google authentication is required")]
    AuthenticationRequired,
    #[error("Google Drive denied access to the file")]
    AccessDenied,
    #[error("Google Drive request failed: {0}")]
    Request(#[from] reqwest::Error),
    #[error("Unexpected Google Drive response status: {status}")]
    UnexpectedStatus { status: reqwest::StatusCode },
    /// An unsafe, malformed or incomplete response that must not be used.
    /// The reason is diagnostic text, not a category callers should match on.
    #[error("Invalid Google Drive response: {reason}")]
    InvalidResponse {
        reason: &'static str,
        #[source]
        source: Option<Box<dyn std::error::Error + Send + Sync>>,
    },
}

impl RequestError {
    fn invalid_response(reason: &'static str) -> Self {
        Self::InvalidResponse {
            reason,
            source: None,
        }
    }

    fn invalid_response_source(
        reason: &'static str,
        source: impl std::error::Error + Send + Sync + 'static,
    ) -> Self {
        Self::InvalidResponse {
            reason,
            source: Some(Box::new(source)),
        }
    }
}

/// Reusable HTTP client. Cookie scoping, expiry and validation belong to its cookie store.
#[derive(Clone)]
pub struct Client {
    http: reqwest::Client,
}

impl Client {
    /// Uses the supplied store for both outgoing cookies and response cookies.
    /// An empty store is valid: public files do not require authentication.
    ///
    /// ```
    /// let cookies = std::sync::Arc::new(reqwest::cookie::Jar::default());
    /// let client = google_drive::Client::new(cookies)?;
    /// # Ok::<(), reqwest::Error>(())
    /// ```
    pub fn new(
        cookies: std::sync::Arc<impl reqwest::cookie::CookieStore + 'static>,
    ) -> Result<Self, reqwest::Error> {
        let http = reqwest::Client::builder()
            .cookie_provider(cookies)
            .redirect(reqwest::redirect::Policy::none())
            .no_proxy()
            .connect_timeout(std::time::Duration::from_secs(30))
            .build()?;
        Ok(Self { http })
    }

    /// Returns metadata and a streaming body, without creating a local file.
    pub async fn download_file(
        &self,
        url: &url::Url,
    ) -> Result<download::Response, download::Error> {
        let request_url = download_url(url).ok_or(download::Error::UnsupportedUrl)?;
        download::download_file(self, request_url).await
    }

    /// Lists the direct children visible in the embedded view for account 0.
    ///
    /// No API key, OAuth token or JavaScript execution is required.
    /// Pagination and completeness are not guaranteed by this endpoint. Do not infer
    /// deletion from missing entries. Shortcuts are not resolved and folders are not traversed.
    pub async fn list_folder(&self, url: &url::Url) -> Result<folder::Listing, folder::Error> {
        folder::list_folder(self, url).await
    }

    async fn send_request(
        &self,
        mut request_url: url::Url,
        requests: &mut usize,
    ) -> Result<reqwest::Response, RequestError> {
        while *requests < 10 {
            *requests += 1;
            if request_url.host_str() == Some("accounts.google.com") {
                return Err(RequestError::AuthenticationRequired);
            }
            if !is_allowed_download_url(&request_url) {
                return Err(RequestError::invalid_response(
                    "redirect URL is not allowed",
                ));
            }
            let response = self
                .http
                .get(request_url.clone())
                .header("Accept-Encoding", "identity")
                .send()
                .await?;
            if response.status().is_redirection() {
                let location = response
                    .headers()
                    .get("Location")
                    .ok_or_else(|| RequestError::invalid_response("missing redirect location"))?
                    .to_str()
                    .map_err(|source| {
                        RequestError::invalid_response_source(
                            "invalid redirect location header",
                            source,
                        )
                    })?;
                request_url = request_url.join(location).map_err(|source| {
                    RequestError::invalid_response_source("invalid redirect URL", source)
                })?;
                continue;
            }
            return match response.status().as_u16() {
                200 => Ok(response),
                401 => Err(RequestError::AuthenticationRequired),
                403 => Err(RequestError::AccessDenied),
                _ => Err(RequestError::UnexpectedStatus {
                    status: response.status(),
                }),
            };
        }
        Err(RequestError::invalid_response("request limit exceeded"))
    }
}

#[cfg(test)]
#[tokio::test]
async fn empty_store_defers_authentication_until_required() {
    let cookies = std::sync::Arc::new(reqwest::cookie::Jar::default());
    let client = Client::new(cookies).unwrap();
    let url = url::Url::parse("https://example.com/file").unwrap();
    assert!(matches!(
        client.download_file(&url).await,
        Err(download::Error::UnsupportedUrl)
    ));
    assert!(matches!(
        client.list_folder(&url).await,
        Err(folder::Error::UnsupportedUrl)
    ));
    let login = url::Url::parse("https://accounts.google.com/ServiceLogin").unwrap();
    let mut requests = 0;
    assert!(matches!(
        client.send_request(login, &mut requests).await,
        Err(RequestError::AuthenticationRequired)
    ));
}

async fn read_body(response: reqwest::Response, limit: usize) -> Result<Vec<u8>, RequestError> {
    let mut body = Vec::new();
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk?;
        if chunk.len() > limit.saturating_sub(body.len()) {
            return Err(RequestError::invalid_response(
                "HTML body exceeds size limit",
            ));
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

#[cfg(test)]
#[tokio::test]
async fn html_responses_are_bounded() {
    let response = || reqwest::Response::from(http::Response::new("12345"));
    assert_eq!(read_body(response(), 5).await.unwrap(), b"12345");
    assert!(matches!(
        read_body(response(), 4).await,
        Err(RequestError::InvalidResponse {
            reason: "HTML body exceeds size limit",
            ..
        })
    ));
}
