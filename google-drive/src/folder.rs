//! Embedded folder listings. Only direct children are returned; subfolders are not traversed.
//!
//! This endpoint has no verified pagination/completeness contract. A listing, even an empty
//! one, must not be used as evidence that previously observed entries were deleted.

/// Failures while listing the direct children of a folder.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("The URL is not a supported Google Drive folder link")]
    UnsupportedUrl,
    #[error(transparent)]
    Request(#[from] crate::RequestError),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Listing {
    pub entries: Vec<Entry>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Entry {
    pub id: String,
    pub name: String,
    pub url: url::Url,
    pub kind: EntryKind,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EntryKind {
    File,
    Folder,
}

/// Converts a folder link to the cookie-authenticated embedded view for account 0.
/// Resource keys are preserved. Other account-specific links are not supported.
///
/// ```
/// for link in [
///     "https://drive.google.com/drive/folders/root?resourcekey=key#list",
///     "https://drive.google.com/drive/u/0/folders/root?resourcekey=key",
///     "https://drive.google.com/embeddedfolderview?id=root&resourcekey=key",
///     "https://drive.google.com/u/0/embeddedfolderview?id=root&resourcekey=key",
/// ] {
///     let source = url::Url::parse(link).unwrap();
///     let request_url = google_drive::folder::view_url(&source).unwrap();
///     assert_eq!(request_url.as_str(),
///         "https://drive.google.com/u/0/embeddedfolderview?id=root&resourcekey=key");
/// }
/// ```
pub fn view_url(url: &url::Url) -> Option<url::Url> {
    if url.scheme() != "https"
        || url.host_str() != Some("drive.google.com")
        || url.port().is_some()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return None;
    }
    let parts: Vec<_> = url.path().trim_matches('/').split('/').collect();
    let id = match parts.as_slice() {
        ["drive", "folders", id] | ["drive", "u", "0", "folders", id] => (*id).to_owned(),
        ["embeddedfolderview"] | ["u", "0", "embeddedfolderview"] => url
            .query_pairs()
            .find(|(name, _)| name == "id")?
            .1
            .into_owned(),
        _ => return None,
    };
    if !is_valid_id(&id) {
        return None;
    }
    let mut request_url =
        url::Url::parse("https://drive.google.com/u/0/embeddedfolderview").ok()?;
    request_url.query_pairs_mut().append_pair("id", &id);
    if let Some((_, key)) = url.query_pairs().find(|(name, _)| name == "resourcekey") {
        request_url
            .query_pairs_mut()
            .append_pair("resourcekey", &key);
    }
    Some(request_url)
}

#[test]
fn unsupported_folder_links_are_rejected() {
    for input in [
        "http://drive.google.com/drive/folders/root",
        "https://drive.google.com.evil.example/drive/folders/root",
        "https://user@drive.google.com/drive/folders/root",
        "https://drive.google.com:444/drive/folders/root",
        "https://drive.google.com/drive/folders/root/other",
        "https://drive.google.com/drive/u/1/folders/root",
        "https://drive.google.com/embeddedfolderview?id=bad%2Fid",
        "https://drive.google.com/embeddedfolderview",
        "https://drive.google.com/file/d/root/view",
    ] {
        assert!(
            view_url(&url::Url::parse(input).unwrap()).is_none(),
            "{input}"
        );
    }
}

fn is_valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 256
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"_-".contains(&byte))
}

pub(crate) async fn list_folder(client: &crate::Client, url: &url::Url) -> Result<Listing, Error> {
    let request_url = view_url(url).ok_or(Error::UnsupportedUrl)?;
    let mut requests = 0;
    let response = client
        .send_request(request_url.clone(), &mut requests)
        .await?;
    Ok(parse_response(response, &request_url).await?)
}

async fn parse_response(
    response: reqwest::Response,
    request_url: &url::Url,
) -> Result<Listing, crate::RequestError> {
    // Do not accept another folder, a regular Drive page, or a usercontent URL.
    if !matches!(
        response.url().path(),
        "/embeddedfolderview" | "/u/0/embeddedfolderview"
    ) || view_url(response.url()).as_ref() != Some(request_url)
    {
        return Err(crate::RequestError::invalid_response(
            "expected an embedded folder listing",
        ));
    }
    let content_type = response
        .headers()
        .get("Content-Type")
        .and_then(|value| value.to_str().ok())
        .unwrap_or("");
    if !content_type
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .eq_ignore_ascii_case("text/html")
    {
        return Err(crate::RequestError::invalid_response(
            "expected an embedded folder listing",
        ));
    }
    let body = crate::read_body(response, 4 << 20).await?;
    parse_listing(&body, request_url)
}

#[cfg(test)]
use reqwest::ResponseBuilderExt as _;

#[cfg(test)]
fn base_url() -> url::Url {
    url::Url::parse("https://drive.google.com/u/0/embeddedfolderview?id=root").unwrap()
}

#[cfg(test)]
fn create_response(
    url: &str,
    content_type: &str,
    body: impl Into<reqwest::Body>,
) -> reqwest::Response {
    http::Response::builder()
        .url(url::Url::parse(url).unwrap())
        .header("Content-Type", content_type)
        .body(body.into())
        .unwrap()
        .into()
}

#[cfg(test)]
#[tokio::test]
async fn folder_responses_require_the_expected_destination_type_and_bounded_html() {
    let base = base_url();
    let response = create_response(base.as_str(), "text/html; charset=utf-8", HTML);
    assert_eq!(
        parse_response(response, &base).await.unwrap().entries.len(),
        3
    );
    for (url, content_type) in [
        (
            "https://drive.google.com/u/0/embeddedfolderview?id=other",
            "text/html",
        ),
        ("https://drive.google.com/drive/folders/root", "text/html"),
        ("https://accounts.google.com/ServiceLogin", "text/html"),
        (base.as_str(), "application/json"),
    ] {
        let response = create_response(url, content_type, HTML);
        assert!(matches!(
            parse_response(response, &base).await,
            Err(crate::RequestError::InvalidResponse { .. })
        ));
    }
    let response = create_response(base.as_str(), "text/html", "x".repeat((4 << 20) + 1));
    assert!(matches!(
        parse_response(response, &base).await,
        Err(crate::RequestError::InvalidResponse {
            reason: "HTML body exceeds size limit",
            ..
        })
    ));
}

fn parse_listing(body: &[u8], base: &url::Url) -> Result<Listing, crate::RequestError> {
    let html = std::str::from_utf8(body).map_err(|source| {
        crate::RequestError::invalid_response_source("invalid HTML encoding", source)
    })?;
    let document = scraper::Html::parse_document(html);
    let containers = parse_selector(".flip-entries");
    let entries = parse_selector(".flip-entry");
    let links = parse_selector("a[href]");
    let titles = parse_selector(".flip-entry-title");
    let mut containers = document.select(&containers);
    let container = containers
        .next()
        .ok_or(crate::RequestError::invalid_response(
            "expected an embedded folder listing",
        ))?;
    if containers.next().is_some() {
        return Err(crate::RequestError::invalid_response(
            "expected an embedded folder listing",
        ));
    }
    let mut result = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for entry in container.select(&entries) {
        let id = entry
            .value()
            .attr("id")
            .and_then(|id| id.strip_prefix("entry-"))
            .filter(|id| is_valid_id(id))
            .ok_or_else(|| {
                crate::RequestError::invalid_response("missing or invalid folder entry id")
            })?;
        if !seen.insert(id.to_owned()) {
            return Err(crate::RequestError::invalid_response(
                "duplicate folder entry ID",
            ));
        }
        let mut anchors = entry.select(&links);
        let link = anchors.next().ok_or_else(|| {
            crate::RequestError::invalid_response("missing or invalid folder entry link")
        })?;
        if anchors.next().is_some() {
            return Err(crate::RequestError::invalid_response(
                "ambiguous folder entry link",
            ));
        }
        let href = link.value().attr("href").ok_or_else(|| {
            crate::RequestError::invalid_response("missing or invalid folder entry link")
        })?;
        let url = base.join(href).map_err(|source| {
            crate::RequestError::invalid_response_source("invalid folder entry URL", source)
        })?;
        let (kind, canonical) = if let Some(folder) = view_url(&url) {
            (EntryKind::Folder, folder)
        } else if let Some(file) = crate::download_url(&url) {
            (EntryKind::File, file)
        } else {
            return Err(crate::RequestError::invalid_response(
                "folder entry link URL is not allowed",
            ));
        };
        let actual = canonical
            .query_pairs()
            .find(|(name, _)| name == "id")
            .map(|(_, value)| value.into_owned());
        if actual.as_deref() != Some(id) {
            return Err(crate::RequestError::invalid_response(
                "folder entry ID does not match link",
            ));
        }
        let mut names = entry.select(&titles);
        let name = names
            .next()
            .ok_or_else(|| {
                crate::RequestError::invalid_response("missing or invalid folder entry name")
            })?
            .text()
            .collect::<String>();
        if name.is_empty() || names.next().is_some() {
            return Err(crate::RequestError::invalid_response(
                "missing or ambiguous folder entry name",
            ));
        }
        result.push(Entry {
            id: id.into(),
            name,
            url,
            kind,
        });
    }
    // A changed DOM must not silently hide entries outside the expected container.
    if document.select(&entries).count() != result.len() {
        return Err(crate::RequestError::invalid_response(
            "expected an embedded folder listing",
        ));
    }
    Ok(Listing { entries: result })
}

#[cfg(test)]
const HTML: &str = r#"<!doctype html><html><body><div class="flip-entries">
    <div class="flip-entry" id="entry-file_1"><a href="https://drive.google.com/file/d/file_1/view?resourcekey=key&amp;usp=drivesdk"><div class="flip-entry-title">講義資料 &amp; notes.pdf</div></a></div>
    <div class="flip-entry" id="entry-folder-2"><a href="/drive/folders/folder-2"><div class="flip-entry-title">子フォルダー</div></a></div>
    <div class="flip-entry" id="entry-file_3"><a href="https://docs.google.com/document/d/file_3/edit"><div class="flip-entry-title">講義資料 &amp; notes.pdf</div></a></div>
    </div></body></html>"#;

#[test]
fn listing_preserves_order_names_ids_links_and_entry_kinds() {
    let listing = parse_listing(HTML.as_bytes(), &base_url()).unwrap();
    assert_eq!(listing.entries.len(), 3);
    assert_eq!(listing.entries[0].id, "file_1");
    assert_eq!(listing.entries[0].name, "講義資料 & notes.pdf");
    assert_eq!(listing.entries[0].kind, EntryKind::File);
    assert!(
        listing.entries[0]
            .url
            .query_pairs()
            .any(|(name, value)| name == "resourcekey" && value == "key")
    );
    assert_eq!(listing.entries[1].id, "folder-2");
    assert_eq!(listing.entries[1].kind, EntryKind::Folder);
    assert_eq!(listing.entries[2].id, "file_3");
    assert_eq!(listing.entries[2].name, listing.entries[0].name);
}

#[test]
fn login_redirect_and_unexpected_pages_are_not_empty_listings() {
    for html in [
        "<html><title>Sign in</title></html>",
        "<html><meta http-equiv=refresh content='0;url=https://accounts.google.com/'></html>",
        "<html>Redirecting...</html>",
        "<html><script>window['_DRIVE_ivd'] = [];</script></html>",
        "<div class=flip-entries></div><div class=flip-entries></div>",
        "<div class=flip-entries></div><div class=flip-entry></div>",
    ] {
        assert!(matches!(
            parse_listing(html.as_bytes(), &base_url()),
            Err(crate::RequestError::InvalidResponse { .. })
        ));
    }
    assert!(
        parse_listing(b"<div class=flip-entries></div>", &base_url())
            .unwrap()
            .entries
            .is_empty()
    );
    assert!(matches!(
        parse_listing(&[0xff], &base_url()),
        Err(crate::RequestError::InvalidResponse {
            reason: "invalid HTML encoding",
            ..
        })
    ));
}

#[test]
fn malformed_duplicate_and_mismatched_entries_fail_the_entire_listing() {
    for html in [
        HTML.replace("entry-file_3", "entry-file_1"),
        HTML.replace("entry-file_1", "entry-bad/id"),
        HTML.replace("/file/d/file_1/", "/file/d/other/"),
        HTML.replace(
            "https://drive.google.com/file/d/file_1/view",
            "https://evil.example/file/d/file_1/view",
        ),
        HTML.replace("class=\"flip-entry-title\"", "class=\"unexpected-title\""),
        HTML.replace("<a href=", "<a data-href="),
        HTML.replace("講義資料 &amp; notes.pdf", ""),
    ] {
        assert!(parse_listing(html.as_bytes(), &base_url()).is_err());
    }
    assert!(matches!(
        parse_listing(
            HTML.replace("entry-file_3", "entry-file_1").as_bytes(),
            &base_url()
        ),
        Err(crate::RequestError::InvalidResponse {
            reason: "duplicate folder entry ID",
            ..
        })
    ));
    assert!(matches!(
        parse_listing(
            HTML.replace("/file/d/file_1/", "/file/d/other/").as_bytes(),
            &base_url()
        ),
        Err(crate::RequestError::InvalidResponse {
            reason: "folder entry ID does not match link",
            ..
        })
    ));
}

fn parse_selector(selector: &'static str) -> scraper::Selector {
    scraper::Selector::parse(selector).expect("valid static selector")
}
