use futures_util::StreamExt as _;
use tokio::io::AsyncWriteExt as _;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("Could not create the Google Drive client: {0}")]
    Client(#[source] reqwest::Error),
    #[error(transparent)]
    Download(#[from] google_drive::download::Error),
    #[error(transparent)]
    Stream(#[from] google_drive::download::StreamError),
    #[error("Could not store downloaded content: {0}")]
    Storage(#[source] std::io::Error),
}

pub async fn download_file(
    client: &google_drive::Client,
    request_url: &url::Url,
    temporary: &std::path::Path,
) -> Result<crate::files::Source, Error> {
    let download = client.download_file(request_url).await?;
    let filename = crate::files::safe_filename(&download.filename);
    let file = tempfile::NamedTempFile::new_in(temporary).map_err(Error::Storage)?;
    let mut output = tokio::fs::File::from_std(file.reopen().map_err(Error::Storage)?);
    let stream = download.bytes_stream();
    futures_util::pin_mut!(stream);
    while let Some(chunk) = stream.next().await {
        output.write_all(&chunk?).await.map_err(Error::Storage)?;
    }
    output.sync_all().await.map_err(Error::Storage)?;
    Ok(crate::files::Source {
        temporary_file: file,
        original_filename: filename,
    })
}

#[tokio::test]
async fn downloads_use_the_supplied_client_without_creating_files_for_unsupported_urls() {
    let client =
        google_drive::Client::new(std::sync::Arc::new(reqwest::cookie::Jar::default())).unwrap();
    let temporary = tempfile::tempdir().unwrap();
    assert!(matches!(
        download_file(
            &client,
            &url::Url::parse("https://example.com/file").unwrap(),
            temporary.path()
        )
        .await,
        Err(Error::Download(
            google_drive::download::Error::UnsupportedUrl
        ))
    ));
    assert_eq!(std::fs::read_dir(temporary.path()).unwrap().count(), 0);
}
