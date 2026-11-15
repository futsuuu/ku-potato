use futures_util::StreamExt as _;
use tokio::io::AsyncWriteExt as _;

pub fn download_url(url: &crate::model::WebUrl) -> Option<url::Url> {
    let url = url.as_ref();
    if url.scheme() != "https" || url.port().is_some() {
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
    let mut destination = url::Url::parse("https://drive.google.com/uc").ok()?;
    destination
        .query_pairs_mut()
        .append_pair("id", &id)
        .append_pair("export", "download")
        .append_pair("authuser", "0");
    if let Some((_, key)) = url.query_pairs().find(|(name, _)| name == "resourcekey") {
        destination
            .query_pairs_mut()
            .append_pair("resourcekey", &key);
    }
    Some(destination)
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

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("Invalid Google cookie field: {field}")]
    InvalidCookie { field: &'static str },
    #[error("Invalid Google Drive URL {value:?}: {source}")]
    InvalidUrl {
        value: String,
        #[source]
        source: url::ParseError,
    },
    #[error("The Google Drive response is missing {field}")]
    MissingField { field: &'static str },
    #[error("Invalid redirect location header: {0}")]
    InvalidRedirectHeader(#[from] reqwest::header::ToStrError),
    #[error("Google Drive download destination is not allowed: {url}")]
    InvalidDestination { url: url::Url },
    #[error("Unexpected Google Drive response status: {status}")]
    UnexpectedStatus { status: reqwest::StatusCode },
    #[error("Google Drive denied access to the file")]
    AccessDenied,
    #[error("Google Drive did not return a downloadable file")]
    NotDownloadable,
    #[error(
        "The Google Drive download size overflowed after {received} bytes and a chunk of {chunk_size} bytes"
    )]
    DownloadSizeOverflow { received: u64, chunk_size: usize },
    #[error(
        "The Google Drive download size does not match: expected {expected} bytes, received {received}"
    )]
    DownloadSizeMismatch { expected: u64, received: u64 },
    #[error("Google Drive exceeded the download request limit")]
    RequestLimitExceeded,
    #[error("Google Drive exceeded the confirmation limit")]
    ConfirmationLimitExceeded,
    #[error("Google Drive confirmation body exceeds {limit} bytes: received {received}")]
    ConfirmationBodyTooLarge { limit: usize, received: usize },
    #[error("Invalid Google Drive confirmation encoding: {0}")]
    InvalidConfirmationEncoding(#[from] std::str::Utf8Error),
    #[error("Invalid confirmation selector: {selector}")]
    InvalidSelector { selector: &'static str },
    #[error("Google Drive confirmation destination is not allowed: {url}")]
    InvalidConfirmationDestination { url: url::Url },
    #[error("Google Drive confirmation method must be GET, received {method}")]
    InvalidConfirmationMethod { method: String },
    #[error(
        "Google Drive confirmation file ID does not match: expected {expected}, received {actual:?}"
    )]
    FileIdMismatch {
        expected: String,
        actual: Option<String>,
    },
    #[error("Google Drive confirmation export must be download, received {value:?}")]
    InvalidExport { value: Option<String> },
}

pub async fn download_file(
    browser: &super::Client,
    mut destination: url::Url,
    temporary: &std::path::Path,
) -> Result<crate::files::Source, super::Error> {
    let jar = reqwest::cookie::Jar::default();
    let mut usable = false;
    for cookie in browser.google_cookies().await? {
        let host = cookie.domain.trim_start_matches('.');
        if cookie.partition_key.is_some()
            || !["google.com", "google.co.jp", "googleusercontent.com"]
                .iter()
                .any(|suffix| host == *suffix || host.ends_with(&format!(".{suffix}")))
        {
            continue;
        }
        if let Some(expires) = cookie.expires
            && super::decode::timestamp(expires)? <= chrono::Utc::now()
        {
            continue;
        }
        if cookie.name.contains([';', '\r', '\n']) {
            return Err(Error::InvalidCookie { field: "name" }.into());
        }
        if cookie.value.contains([';', '\r', '\n']) {
            return Err(Error::InvalidCookie { field: "value" }.into());
        }
        if cookie.path.contains([';', '\r', '\n']) {
            return Err(Error::InvalidCookie { field: "path" }.into());
        }
        let origin = format!("https://{host}/");
        let origin = url::Url::parse(&origin).map_err(|source| Error::InvalidUrl {
            value: origin,
            source,
        })?;
        let mut value = format!("{}={}; Path={}", cookie.name, cookie.value, cookie.path);
        if cookie.domain.starts_with('.') {
            value.push_str(&format!("; Domain={}", cookie.domain));
        }
        if cookie.secure {
            value.push_str("; Secure");
        }
        if cookie.http_only {
            value.push_str("; HttpOnly");
        }
        jar.add_cookie_str(&value, &origin);
        usable = true;
    }
    if !usable {
        return Err(super::Error::AuthenticationRequired(
            super::Provider::Google,
        ));
    }
    let client = reqwest::Client::builder()
        .cookie_provider(std::sync::Arc::new(jar))
        .redirect(reqwest::redirect::Policy::none())
        .no_proxy()
        .connect_timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(super::Error::DriveRequest)?;
    let id = destination
        .query_pairs()
        .find(|(name, _)| name == "id")
        .ok_or(Error::MissingField {
            field: "download file ID",
        })?
        .1
        .into_owned();
    let resource_key = destination
        .query_pairs()
        .find(|(name, _)| name == "resourcekey")
        .map(|(_, value)| value.into_owned());
    let mut confirmations = 0;
    for _ in 0..10 {
        if destination.host_str() == Some("accounts.google.com") {
            return Err(super::Error::AuthenticationRequired(
                super::Provider::Google,
            ));
        }
        if !is_allowed_download_url(&destination) {
            return Err(Error::InvalidDestination { url: destination }.into());
        }
        let response = client
            .get(destination.clone())
            .header("Accept-Encoding", "identity")
            .send()
            .await
            .map_err(super::Error::DriveRequest)?;
        if response.status().is_redirection() {
            let location = response
                .headers()
                .get("Location")
                .ok_or(Error::MissingField {
                    field: "redirect location",
                })?
                .to_str()
                .map_err(Error::InvalidRedirectHeader)?;
            destination = destination
                .join(location)
                .map_err(|source| Error::InvalidUrl {
                    value: location.into(),
                    source,
                })?;
            continue;
        }
        match response.status().as_u16() {
            401 => {
                return Err(super::Error::AuthenticationRequired(
                    super::Provider::Google,
                ));
            }
            403 => {
                return Err(Error::AccessDenied.into());
            }
            200 => (),
            _ => {
                return Err(Error::UnexpectedStatus {
                    status: response.status(),
                }
                .into());
            }
        }
        let disposition = response
            .headers()
            .get("Content-Disposition")
            .and_then(|value| value.to_str().ok())
            .map(mailparse::parse_content_disposition);
        if let Some(disposition) = disposition
            && disposition.disposition == mailparse::DispositionType::Attachment
            && let Some(filename) = disposition.params.get("filename")
        {
            let filename = crate::files::safe_filename(filename);
            let expected = response.content_length();
            let file = tempfile::NamedTempFile::new_in(temporary)
                .map_err(super::Error::DownloadStorage)?;
            let mut output =
                tokio::fs::File::from_std(file.reopen().map_err(super::Error::DownloadStorage)?);
            let mut stream = response.bytes_stream();
            let mut size = 0_u64;
            while let Some(chunk) = stream.next().await {
                let chunk = chunk.map_err(super::Error::DriveRequest)?;
                size = size
                    .checked_add(chunk.len() as u64)
                    .ok_or(Error::DownloadSizeOverflow {
                        received: size,
                        chunk_size: chunk.len(),
                    })?;
                if let Some(expected) = expected
                    && size > expected
                {
                    return Err(Error::DownloadSizeMismatch {
                        expected,
                        received: size,
                    }
                    .into());
                }
                output
                    .write_all(&chunk)
                    .await
                    .map_err(super::Error::DownloadStorage)?;
            }
            if let Some(expected) = expected
                && size != expected
            {
                return Err(Error::DownloadSizeMismatch {
                    expected,
                    received: size,
                }
                .into());
            }
            output
                .sync_all()
                .await
                .map_err(super::Error::DownloadStorage)?;
            return Ok(crate::files::Source {
                temporary_file: file,
                original_filename: filename,
            });
        }
        confirmations += 1;
        if confirmations > 3 {
            return Err(Error::ConfirmationLimitExceeded.into());
        }
        let mut body = Vec::new();
        let mut stream = response.bytes_stream();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(super::Error::DriveRequest)?;
            if body.len() + chunk.len() > 1 << 20 {
                return Err(Error::ConfirmationBodyTooLarge {
                    limit: 1 << 20,
                    received: body.len() + chunk.len(),
                }
                .into());
            }
            body.extend_from_slice(&chunk);
        }
        destination = confirmation_url(&body, &destination, &id, resource_key.as_deref())?;
    }
    Err(Error::RequestLimitExceeded.into())
}

fn confirmation_url(
    body: &[u8],
    base: &url::Url,
    id: &str,
    resource_key: Option<&str>,
) -> Result<url::Url, Error> {
    let document = scraper::Html::parse_document(std::str::from_utf8(body)?);
    let selector =
        scraper::Selector::parse("form#download-form").map_err(|_| Error::InvalidSelector {
            selector: "form#download-form",
        })?;
    let form = document
        .select(&selector)
        .next()
        .ok_or(Error::NotDownloadable)?;
    let action = form.value().attr("action").ok_or(Error::MissingField {
        field: "confirmation action",
    })?;
    let mut destination = base.join(action).map_err(|source| Error::InvalidUrl {
        value: action.into(),
        source,
    })?;
    if !is_allowed_download_url(&destination)
        || destination.host_str() != Some("drive.usercontent.google.com")
        || destination.path() != "/download"
    {
        return Err(Error::InvalidConfirmationDestination { url: destination });
    }
    let method = form.value().attr("method").unwrap_or("get");
    if !method.eq_ignore_ascii_case("get") {
        return Err(Error::InvalidConfirmationMethod {
            method: method.into(),
        });
    }
    let selector =
        scraper::Selector::parse("input[type=hidden]").map_err(|_| Error::InvalidSelector {
            selector: "input[type=hidden]",
        })?;
    let mut parameters: std::collections::BTreeMap<String, String> = destination
        .query_pairs()
        .map(|(key, value)| (key.into_owned(), value.into_owned()))
        .collect();
    for input in form.select(&selector) {
        if let Some(name) = input.value().attr("name") {
            parameters.insert(
                name.into(),
                input.value().attr("value").unwrap_or("").into(),
            );
        }
    }
    if parameters.get("id").map(String::as_str) != Some(id) {
        return Err(Error::FileIdMismatch {
            expected: id.into(),
            actual: parameters.get("id").cloned(),
        });
    }
    if parameters.get("export").map(String::as_str) != Some("download") {
        return Err(Error::InvalidExport {
            value: parameters.get("export").cloned(),
        });
    }
    if parameters.get("confirm").is_none_or(String::is_empty) {
        return Err(Error::MissingField {
            field: "confirmation token",
        });
    }
    if let Some(key) = resource_key {
        parameters.insert("resourcekey".into(), key.into());
    }
    destination
        .query_pairs_mut()
        .clear()
        .extend_pairs(parameters);
    Ok(destination)
}

#[cfg(test)]
mod tests {
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
            let url = super::download_url(&input.to_owned().try_into().unwrap()).unwrap();
            assert_eq!(url.host_str(), Some("drive.google.com"));
            assert_eq!(url.path(), "/uc");
            assert!(
                url.query_pairs()
                    .any(|(key, value)| key == "id" && value == "abc_123")
            );
        }
        let url = super::download_url(
            &"https://drive.google.com/file/d/abc/view?resourcekey=secret"
                .to_owned()
                .try_into()
                .unwrap(),
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
                super::download_url(&input.to_owned().try_into().unwrap()).is_none(),
                "{input}"
            );
        }
    }

    #[test]
    fn confirmation_forms_cannot_change_file_identity_or_destination() {
        let base = url::Url::parse("https://drive.google.com/uc?id=abc").unwrap();
        let form = r#"<form id="download-form" action="https://drive.usercontent.google.com/download" method="get"><input type="hidden" name="id" value="abc"><input type="hidden" name="export" value="download"><input type="hidden" name="confirm" value="token"></form>"#;
        let destination =
            super::confirmation_url(form.as_bytes(), &base, "abc", Some("resource")).unwrap();
        assert!(
            destination
                .query_pairs()
                .any(|(key, value)| key == "resourcekey" && value == "resource")
        );
        assert!(matches!(
            super::confirmation_url(form.replace("value=\"abc\"", "value=\"other\"").as_bytes(), &base, "abc", None),
            Err(super::Error::FileIdMismatch { expected, actual: Some(actual) })
                if expected == "abc" && actual == "other"
        ));
        assert!(matches!(
            super::confirmation_url(form.replace("method=\"get\"", "method=\"post\"").as_bytes(), &base, "abc", None),
            Err(super::Error::InvalidConfirmationMethod { method }) if method == "post"
        ));
        assert!(matches!(
            super::confirmation_url(form.replace("drive.usercontent.google.com", "evil.example").as_bytes(), &base, "abc", None),
            Err(super::Error::InvalidConfirmationDestination { url }) if url.host_str() == Some("evil.example")
        ));
        assert!(matches!(
            super::confirmation_url(form.replace("value=\"download\"", "value=\"preview\"").as_bytes(), &base, "abc", None),
            Err(super::Error::InvalidExport { value: Some(value) }) if value == "preview"
        ));
        assert!(matches!(
            super::confirmation_url(
                form.replace("https://drive.usercontent.google.com/download", "http://[").as_bytes(),
                &base, "abc", None,
            ),
            Err(super::Error::InvalidUrl { value, source: url::ParseError::InvalidIpv6Address }) if value == "http://["
        ));
        let encoding = super::confirmation_url(&[0xff], &base, "abc", None).unwrap_err();
        assert!(
            matches!(&encoding, super::Error::InvalidConfirmationEncoding(source) if source.valid_up_to() == 0)
        );
        assert!(
            std::error::Error::source(&encoding)
                .unwrap()
                .is::<std::str::Utf8Error>()
        );
        for invalid in [
            form.replace("drive.usercontent.google.com", "evil.example"),
            form.replace("https://", "http://"),
            form.replace("value=\"abc\"", "value=\"other\""),
            form.replace("method=\"get\"", "method=\"post\""),
            form.replace("value=\"token\"", "value=\"\""),
            "<html>Login</html>".into(),
        ] {
            assert!(super::confirmation_url(invalid.as_bytes(), &base, "abc", None).is_err());
        }
    }
}
