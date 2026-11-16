use futures_util::StreamExt as _;

/// Failures before a downloadable response has been obtained.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("The URL is not a supported Google Drive file link")]
    UnsupportedUrl,
    #[error("Google Drive did not return a downloadable file")]
    NotDownloadable,
    #[error(transparent)]
    Request(#[from] crate::RequestError),
}

/// Failures while consuming an already accepted download body.
#[derive(Debug, thiserror::Error)]
pub enum StreamError {
    #[error("Google Drive response body failed: {0}")]
    Request(#[from] reqwest::Error),
    #[error(
        "Google Drive download size does not match: expected {expected} bytes, received {received}"
    )]
    SizeMismatch { expected: u64, received: u64 },
    #[error(
        "Google Drive download size overflowed after {received} bytes and a chunk of {chunk_size} bytes"
    )]
    SizeOverflow { received: u64, chunk_size: usize },
}

/// A download ready to stream. The filename is remote metadata, not a safe local path.
pub struct Response {
    pub filename: String,
    pub content_length: Option<u64>,
    pub content_type: Option<String>,
    response: reqwest::Response,
}

impl Response {
    /// Checks the received length while streaming, including at end-of-stream.
    ///
    /// Once a response is returned, only transport or byte-count errors can occur;
    /// unsupported URLs, login requirements and access checks belong to `Error`.
    pub fn bytes_stream(
        self,
    ) -> impl futures_util::Stream<Item = Result<bytes::Bytes, StreamError>> + Send {
        let expected = self.content_length;
        async_stream::try_stream! {
            let mut stream = self.response.bytes_stream();
            let mut size = 0_u64;
            while let Some(chunk) = stream.next().await {
                let chunk = chunk.map_err(StreamError::Request)?;
                size = size.checked_add(chunk.len() as u64)
                    .ok_or(StreamError::SizeOverflow { received: size, chunk_size: chunk.len() })?;
                if let Some(expected) = expected
                    && size > expected
                {
                    Err(StreamError::SizeMismatch { expected, received: size })?;
                }
                yield chunk;
            }
            if let Some(expected) = expected
                && size != expected
            {
                Err(StreamError::SizeMismatch { expected, received: size })?;
            }
        }
    }
}

#[cfg(test)]
fn create_download(content: &'static [u8], expected: Option<u64>) -> Response {
    Response {
        filename: "../remote.pdf".into(),
        content_length: expected,
        content_type: Some("application/pdf".into()),
        response: reqwest::Response::from(http::Response::new(content)),
    }
}

#[cfg(test)]
#[tokio::test]
async fn streaming_checks_sizes_without_touching_the_filesystem() {
    for expected in [Some(5), None] {
        let download = create_download(b"hello", expected);
        assert_eq!(download.filename, "../remote.pdf");
        let chunks = download.bytes_stream().collect::<Vec<_>>().await;
        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0].as_ref().unwrap().as_ref(), b"hello");
    }
    for expected in [4, 6] {
        let chunks = create_download(b"hello", Some(expected))
            .bytes_stream()
            .collect::<Vec<_>>()
            .await;
        assert!(matches!(
            chunks.last().unwrap(),
            Err(StreamError::SizeMismatch { expected: actual, received: 5 }) if *actual == expected
        ));
    }
    assert!(
        create_download(b"", Some(0))
            .bytes_stream()
            .collect::<Vec<_>>()
            .await
            .is_empty()
    );
}

#[cfg(test)]
#[tokio::test]
async fn streaming_transport_errors_remain_body_errors() {
    let body = reqwest::Body::wrap_stream(futures_util::stream::iter([Err::<bytes::Bytes, _>(
        std::io::Error::other("broken response body"),
    )]));
    let download = Response {
        filename: "file.pdf".into(),
        content_length: None,
        content_type: None,
        response: http::Response::new(body).into(),
    };
    let chunks = download.bytes_stream().collect::<Vec<_>>().await;
    assert_eq!(chunks.len(), 1);
    let error = chunks.into_iter().next().unwrap().unwrap_err();
    assert!(matches!(&error, StreamError::Request(_)));
    assert!(
        std::error::Error::source(&error)
            .unwrap()
            .is::<reqwest::Error>()
    );
}

pub(crate) async fn download_file(
    client: &crate::Client,
    mut request_url: url::Url,
) -> Result<Response, Error> {
    let id = request_url
        .query_pairs()
        .find(|(name, _)| name == "id")
        .ok_or_else(|| crate::RequestError::invalid_response("missing download file ID"))?
        .1
        .into_owned();
    let resource_key = request_url
        .query_pairs()
        .find(|(name, _)| name == "resourcekey")
        .map(|(_, value)| value.into_owned());
    let mut requests = 0;
    for confirmations in 0..=3 {
        let response = client
            .send_request(request_url.clone(), &mut requests)
            .await?;
        let disposition = response
            .headers()
            .get("Content-Disposition")
            .and_then(|value| value.to_str().ok())
            .map(mailparse::parse_content_disposition);
        if let Some(disposition) = disposition
            && disposition.disposition == mailparse::DispositionType::Attachment
            && let Some(filename) = disposition.params.get("filename")
        {
            return Ok(Response {
                filename: filename.clone(),
                content_length: response.content_length(),
                content_type: response
                    .headers()
                    .get("Content-Type")
                    .and_then(|value| value.to_str().ok())
                    .map(str::to_owned),
                response,
            });
        }
        if confirmations == 3 {
            return Err(
                crate::RequestError::invalid_response("confirmation limit exceeded").into(),
            );
        }
        let base = response.url().clone();
        let body = crate::read_body(response, 1 << 20).await?;
        request_url = confirmation_url(&body, &base, &id, resource_key.as_deref())?;
    }
    Err(crate::RequestError::invalid_response("confirmation limit exceeded").into())
}

fn confirmation_url(
    body: &[u8],
    base: &url::Url,
    id: &str,
    resource_key: Option<&str>,
) -> Result<url::Url, Error> {
    let html = std::str::from_utf8(body).map_err(|source| {
        crate::RequestError::invalid_response_source("invalid HTML encoding", source)
    })?;
    let document = scraper::Html::parse_document(html);
    let selector = scraper::Selector::parse("form#download-form").expect("valid static selector");
    let form = document
        .select(&selector)
        .next()
        .ok_or(Error::NotDownloadable)?;
    let action = form
        .value()
        .attr("action")
        .ok_or_else(|| crate::RequestError::invalid_response("missing confirmation action"))?;
    let mut request_url = base.join(action).map_err(|source| {
        crate::RequestError::invalid_response_source("invalid confirmation URL", source)
    })?;
    if !crate::is_allowed_download_url(&request_url)
        || request_url.host_str() != Some("drive.usercontent.google.com")
        || request_url.path() != "/download"
    {
        return Err(
            crate::RequestError::invalid_response("confirmation URL is not allowed").into(),
        );
    }
    let method = form.value().attr("method").unwrap_or("get");
    if !method.eq_ignore_ascii_case("get") {
        return Err(
            crate::RequestError::invalid_response("confirmation method must be GET").into(),
        );
    }
    let selector = scraper::Selector::parse("input[type=hidden]").expect("valid static selector");
    let mut parameters: std::collections::BTreeMap<String, String> = request_url
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
        return Err(
            crate::RequestError::invalid_response("confirmation file ID does not match").into(),
        );
    }
    if parameters.get("export").map(String::as_str) != Some("download") {
        return Err(
            crate::RequestError::invalid_response("confirmation export must be download").into(),
        );
    }
    if parameters.get("confirm").is_none_or(String::is_empty) {
        return Err(crate::RequestError::invalid_response("missing confirmation token").into());
    }
    if let Some(key) = resource_key {
        parameters.insert("resourcekey".into(), key.into());
    }
    request_url
        .query_pairs_mut()
        .clear()
        .extend_pairs(parameters);
    Ok(request_url)
}

#[test]
fn confirmation_forms_cannot_change_file_identity_or_destination() {
    let base = url::Url::parse("https://drive.google.com/uc?id=abc").unwrap();
    let form = r#"<form id="download-form" action="https://drive.usercontent.google.com/download" method="get"><input type="hidden" name="id" value="abc"><input type="hidden" name="export" value="download"><input type="hidden" name="confirm" value="token"></form>"#;
    let request_url = confirmation_url(form.as_bytes(), &base, "abc", Some("resource")).unwrap();
    assert!(
        request_url
            .query_pairs()
            .any(|(key, value)| key == "resourcekey" && value == "resource")
    );
    for invalid in [
        form.replace("drive.usercontent.google.com", "evil.example"),
        form.replace("https://", "http://"),
        form.replace("value=\"abc\"", "value=\"other\""),
        form.replace("method=\"get\"", "method=\"post\""),
        form.replace("value=\"download\"", "value=\"preview\""),
        form.replace("value=\"token\"", "value=\"\""),
        form.replace("name=\"confirm\"", "name=\"other\""),
        form.replace("action=", "data-action="),
    ] {
        assert!(matches!(
            confirmation_url(invalid.as_bytes(), &base, "abc", None),
            Err(Error::Request(crate::RequestError::InvalidResponse { .. }))
        ));
    }
    assert!(matches!(
        confirmation_url(b"<html>Not a download</html>", &base, "abc", None),
        Err(Error::NotDownloadable)
    ));
    let encoding = confirmation_url(&[0xff], &base, "abc", None).unwrap_err();
    assert!(
        std::error::Error::source(&encoding)
            .unwrap()
            .is::<std::str::Utf8Error>()
    );
    let url = confirmation_url(
        form.replace("https://drive.usercontent.google.com/download", "http://[")
            .as_bytes(),
        &base,
        "abc",
        None,
    )
    .unwrap_err();
    assert!(
        std::error::Error::source(&url)
            .unwrap()
            .is::<url::ParseError>()
    );
}
