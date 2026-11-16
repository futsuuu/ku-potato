use futures_util::StreamExt as _;
use tokio::io::AsyncWriteExt as _;

pub fn download_url(url: &crate::model::WebUrl) -> Option<url::Url> {
    google_drive::download_url(url.as_ref())
}

fn map_error(error: google_drive::download::Error) -> super::Error {
    match error {
        google_drive::download::Error::Request(
            google_drive::RequestError::AuthenticationRequired,
        ) => super::Error::AuthenticationRequired(super::Provider::Google),
        google_drive::download::Error::Request(google_drive::RequestError::Request(source)) => {
            super::Error::DriveRequest(source)
        }
        error => super::Error::Drive(error),
    }
}

fn map_stream_error(error: google_drive::download::StreamError) -> super::Error {
    match error {
        google_drive::download::StreamError::Request(source) => super::Error::DriveRequest(source),
        error => super::Error::DriveStream(error),
    }
}

#[test]
fn download_error_mapping_preserves_authentication_and_stream_failure_classifications() {
    let authentication = map_error(google_drive::download::Error::Request(
        google_drive::RequestError::AuthenticationRequired,
    ));
    assert!(matches!(
        authentication,
        super::Error::AuthenticationRequired(super::Provider::Google)
    ));
    let stream = map_stream_error(google_drive::download::StreamError::SizeMismatch {
        expected: 6,
        received: 5,
    });
    assert!(matches!(stream, super::Error::DriveStream(_)));
    let public = crate::error::Public::from(&stream);
    assert_eq!(public.reason, crate::error::Reason::Source);
    assert_eq!(public.message, "Could not download the Google Drive file");

    let request = map_stream_error(google_drive::download::StreamError::Request(
        reqwest::Client::new()
            .get("http://[private")
            .build()
            .unwrap_err(),
    ));
    assert!(matches!(request, super::Error::DriveRequest(_)));
    assert!(
        std::error::Error::source(&request)
            .unwrap()
            .is::<reqwest::Error>()
    );
    assert!(
        !crate::error::Public::from(&request)
            .message
            .contains("private")
    );
}

fn create_cookie_store(
    cookies: Vec<super::protocol::user_browser::Cookie>,
) -> Result<reqwest_cookie_store::CookieStoreMutex, super::Error> {
    let mut store = reqwest_cookie_store::CookieStore::new();
    for cookie in cookies {
        let host = cookie.domain.trim_start_matches('.');
        if cookie.partition_key.is_some()
            || !["google.com", "google.co.jp", "googleusercontent.com"]
                .iter()
                .any(|suffix| host == *suffix || host.ends_with(&format!(".{suffix}")))
        {
            continue;
        }
        let origin = url::Url::parse(&format!("https://{host}/")).map_err(|source| {
            super::Error::InvalidResponse {
                field: "Google cookie origin",
                details: serde_json::Value::Null,
                source: Some(Box::new(source)),
            }
        })?;
        let mut raw = reqwest_cookie_store::RawCookie::build((cookie.name, cookie.value))
            .path(cookie.path)
            .secure(cookie.secure)
            .http_only(cookie.http_only);
        if cookie.domain.starts_with('.') {
            raw = raw.domain(cookie.domain);
        }
        if let Some(expires) = cookie.expires {
            let expires: time::OffsetDateTime =
                std::time::SystemTime::from(super::decode::timestamp(expires)?).into();
            raw = raw.expires(expires);
        }
        // The native store handles validity, expiry, domain and path matching.
        store.store_response_cookies(std::iter::once(raw.build()), &origin);
    }
    Ok(reqwest_cookie_store::CookieStoreMutex::new(store))
}

#[cfg(test)]
fn create_cookie(domain: &str) -> super::protocol::user_browser::Cookie {
    super::protocol::user_browser::Cookie {
        name: "SID".into(),
        value: "test".into(),
        domain: domain.into(),
        path: "/".into(),
        secure: true,
        http_only: true,
        ..Default::default()
    }
}

#[test]
fn browser_cookie_conversion_preserves_scope_and_excludes_unusable_cookies() {
    use reqwest::cookie::CookieStore as _;

    let mut scoped = create_cookie("drive.google.com");
    scoped.name = "SCOPED".into();
    scoped.path = "/uc".into();
    let mut expired = create_cookie(".google.com");
    expired.name = "EXPIRED".into();
    expired.expires = Some(prost_types::Timestamp {
        seconds: 1,
        nanos: 0,
    });
    let mut partitioned = create_cookie(".google.com");
    partitioned.name = "PARTITIONED".into();
    partitioned.partition_key = Some(Default::default());
    let mut future = create_cookie(".google.com");
    future.name = "FUTURE".into();
    future.expires = Some(prost_types::Timestamp {
        seconds: chrono::Utc::now().timestamp() + 3600,
        nanos: 0,
    });
    let store = create_cookie_store(vec![
        create_cookie(".google.com"),
        scoped,
        expired,
        partitioned,
        future,
        create_cookie("evil.example"),
        create_cookie("google.com.evil.example"),
    ])
    .unwrap();
    let values = |url| {
        store
            .cookies(&url::Url::parse(url).unwrap())
            .map(|value| value.to_str().unwrap().to_owned())
            .unwrap_or_default()
    };
    let download = values("https://drive.google.com/uc");
    assert!(download.contains("SID=test"));
    assert!(download.contains("SCOPED=test"));
    assert!(download.contains("FUTURE=test"));
    assert!(!download.contains("EXPIRED"));
    assert!(!download.contains("PARTITIONED"));
    assert!(!values("https://accounts.google.com/").contains("SCOPED"));
    assert!(!values("https://drive.google.com/elsewhere").contains("SCOPED"));
    assert_eq!(values("https://evil.example/"), "");
    assert_eq!(values("https://google.com.evil.example/"), "");
    assert_eq!(values("http://drive.google.com/uc"), "");
    let empty = create_cookie_store(Vec::new()).unwrap();
    assert!(
        empty
            .cookies(&url::Url::parse("https://drive.google.com/uc").unwrap())
            .is_none()
    );
}

pub async fn download_file(
    browser: &super::Client,
    request_url: url::Url,
    temporary: &std::path::Path,
) -> Result<crate::files::Source, super::Error> {
    let cookies = create_cookie_store(browser.google_cookies().await?)?;
    let client = google_drive::Client::new(std::sync::Arc::new(cookies))
        .map_err(super::Error::DriveRequest)?;
    let download = client
        .download_file(&request_url)
        .await
        .map_err(map_error)?;
    let filename = crate::files::safe_filename(&download.filename);
    let file = tempfile::NamedTempFile::new_in(temporary).map_err(super::Error::DownloadStorage)?;
    let mut output =
        tokio::fs::File::from_std(file.reopen().map_err(super::Error::DownloadStorage)?);
    let stream = download.bytes_stream();
    futures_util::pin_mut!(stream);
    while let Some(chunk) = stream.next().await {
        output
            .write_all(&chunk.map_err(map_stream_error)?)
            .await
            .map_err(super::Error::DownloadStorage)?;
    }
    output
        .sync_all()
        .await
        .map_err(super::Error::DownloadStorage)?;
    Ok(crate::files::Source {
        temporary_file: file,
        original_filename: filename,
    })
}
