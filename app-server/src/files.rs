use sha2::Digest as _;
use std::io::Read as _;
use std::io::Write as _;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("No saved data is available")]
    Missing,
    #[error("Invalid saved content: {0}")]
    InvalidContent(&'static str),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error("A file storage task failed: {0}")]
    Task(#[from] tokio::task::JoinError),
}

pub struct Source {
    pub temporary_file: tempfile::NamedTempFile,
    pub original_filename: String,
}

#[derive(Clone)]
pub struct Store {
    root: std::path::PathBuf,
    materialized: std::path::PathBuf,
}

impl Store {
    pub fn new(root: std::path::PathBuf, temporary: &std::path::Path) -> Result<Self, Error> {
        std::fs::create_dir_all(&root)?;
        let parent = temporary.join("ku-potato-opened-resources");
        crate::settings::create_private_directory(&parent)?;
        for entry in std::fs::read_dir(&parent)?.flatten() {
            if entry.file_name().to_string_lossy().starts_with("session-")
                && entry.file_type()?.is_dir()
            {
                let _ = std::fs::remove_dir_all(entry.path());
            }
        }
        let materialized = tempfile::Builder::new()
            .prefix("session-")
            .tempdir_in(parent)?
            .keep();
        Ok(Self { root, materialized })
    }

    pub async fn save(&self, source: Source) -> Result<crate::model::SavedFile, Error> {
        let store = self.clone();
        tokio::task::spawn_blocking(move || store.save_blocking(source)).await?
    }

    fn save_blocking(&self, source: Source) -> Result<crate::model::SavedFile, Error> {
        let mut input = source.temporary_file.reopen()?;
        let mut output = tempfile::NamedTempFile::new_in(&self.root)?;
        let mut hasher = sha2::Sha256::new();
        let mut encoder = zstd::stream::write::Encoder::new(output.as_file_mut(), 3)?;
        let mut size = 0_u64;
        let mut buffer = [0_u8; 64 * 1024];
        loop {
            let count = input.read(&mut buffer)?;
            if count == 0 {
                break;
            }
            encoder.write_all(&buffer[..count])?;
            hasher.update(&buffer[..count]);
            size = size
                .checked_add(count as u64)
                .ok_or(Error::InvalidContent("file size overflow"))?;
        }
        encoder.finish()?;
        output.as_file().sync_all()?;
        let digest = hex::encode(hasher.finalize());
        let metadata = crate::model::SavedFile {
            content_hash: digest
                .try_into()
                .map_err(|_| Error::InvalidContent("SHA-256 digest"))?,
            original_filename: source.original_filename,
            original_size: size,
        };
        let target = self
            .root
            .join(format!("{}.zst", metadata.content_hash.as_ref()));
        output.persist(&target).map_err(|error| error.error)?;
        Ok(metadata)
    }

    pub async fn remove_content(&self, hash: &crate::model::ContentHash) -> Result<(), Error> {
        match tokio::fs::remove_file(self.root.join(format!("{}.zst", hash.as_ref()))).await {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(error.into()),
        }
    }

    pub async fn materialize(
        &self,
        metadata: crate::model::SavedFile,
    ) -> Result<std::path::PathBuf, Error> {
        let store = self.clone();
        tokio::task::spawn_blocking(move || store.materialize_blocking(&metadata)).await?
    }

    fn materialize_blocking(
        &self,
        metadata: &crate::model::SavedFile,
    ) -> Result<std::path::PathBuf, Error> {
        let filename = safe_filename(&metadata.original_filename);
        let directory = self.materialized.join(metadata.content_hash.as_ref());
        std::fs::create_dir_all(&directory)?;
        let target = directory.join(filename);
        let mut output = tempfile::NamedTempFile::new_in(&directory)?;
        let file = std::fs::File::open(
            self.root
                .join(format!("{}.zst", metadata.content_hash.as_ref())),
        )
        .map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                Error::Missing
            } else {
                error.into()
            }
        })?;
        let input = zstd::stream::read::Decoder::new(file)?;
        let mut input = input.take(metadata.original_size.saturating_add(1));
        let mut hasher = sha2::Sha256::new();
        let mut size = 0_u64;
        let mut buffer = [0_u8; 64 * 1024];
        loop {
            let count = input.read(&mut buffer)?;
            if count == 0 {
                break;
            }
            output.write_all(&buffer[..count])?;
            hasher.update(&buffer[..count]);
            size += count as u64;
        }
        if size != metadata.original_size
            || hex::encode(hasher.finalize()) != metadata.content_hash.as_ref()
        {
            return Err(Error::InvalidContent("saved content hash or size mismatch"));
        }
        output.as_file().sync_all()?;
        output.persist(&target).map_err(|error| error.error)?;
        Ok(target)
    }
}

pub fn safe_filename(filename: &str) -> String {
    let filename = filename.rsplit(['/', '\\']).next().unwrap_or("");
    let filename: String = filename
        .chars()
        .map(|character| {
            if character.is_control() || "<>:\"|?*".contains(character) {
                '_'
            } else {
                character
            }
        })
        .collect();
    let filename = filename.trim_end_matches([' ', '.']);
    let stem = filename
        .split('.')
        .next()
        .unwrap_or("")
        .to_ascii_uppercase();
    if filename.is_empty()
        || [
            "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7",
            "COM8", "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
        ]
        .contains(&stem.as_str())
    {
        "resource".into()
    } else {
        let end = filename
            .char_indices()
            .find(|(index, _)| *index >= 180)
            .map_or(filename.len(), |(index, _)| index);
        filename[..end].to_owned()
    }
}

#[cfg(test)]
mod tests {
    use std::io::Write as _;

    #[tokio::test]
    async fn content_is_compressed_addressed_verified_and_repaired() {
        let temporary = tempfile::tempdir().unwrap();
        let store =
            super::Store::new(temporary.path().join("resources"), temporary.path()).unwrap();
        let content = b"hello world".repeat(10000);
        let mut input = tempfile::NamedTempFile::new_in(temporary.path()).unwrap();
        input.write_all(&content).unwrap();
        let metadata = store
            .save(super::Source {
                temporary_file: input,
                original_filename: "../../lecture.txt".into(),
            })
            .await
            .unwrap();
        assert_eq!(metadata.original_size, content.len() as u64);
        let path = store.materialize(metadata.clone()).await.unwrap();
        assert_eq!(path.file_name().unwrap(), "lecture.txt");
        assert_eq!(std::fs::read(&path).unwrap(), content);
        std::fs::write(&path, b"modified by viewer").unwrap();
        assert_eq!(
            std::fs::read(store.materialize(metadata.clone()).await.unwrap()).unwrap(),
            content
        );
        let compressed = temporary
            .path()
            .join("resources")
            .join(format!("{}.zst", metadata.content_hash.as_ref()));
        std::fs::write(&compressed, b"corrupt").unwrap();
        assert!(store.materialize(metadata.clone()).await.is_err());
        let mut input = tempfile::NamedTempFile::new_in(temporary.path()).unwrap();
        input.write_all(&content).unwrap();
        let repaired = store
            .save(super::Source {
                temporary_file: input,
                original_filename: "lecture.txt".into(),
            })
            .await
            .unwrap();
        assert_eq!(repaired.content_hash, metadata.content_hash);
        assert_eq!(
            std::fs::read(store.materialize(repaired).await.unwrap()).unwrap(),
            content
        );
    }

    #[tokio::test]
    async fn compressed_content_rejects_incorrect_sizes_and_hashes() {
        let temporary = tempfile::tempdir().unwrap();
        let root = temporary.path().join("resources");
        let store = super::Store::new(root.clone(), temporary.path()).unwrap();
        let metadata = crate::model::SavedFile {
            content_hash: hex::encode(<sha2::Sha256 as sha2::Digest>::digest(b"hello"))
                .try_into()
                .unwrap(),
            original_filename: "file.txt".into(),
            original_size: 5,
        };
        let path = root.join(format!("{}.zst", metadata.content_hash.as_ref()));
        std::fs::write(
            &path,
            zstd::stream::encode_all(b"hello".as_slice(), 3).unwrap(),
        )
        .unwrap();
        assert_eq!(
            std::fs::read(store.materialize(metadata.clone()).await.unwrap()).unwrap(),
            b"hello"
        );
        let mut wrong = metadata.clone();
        wrong.original_size = 4;
        assert!(store.materialize(wrong).await.is_err());
        std::fs::write(
            &path,
            zstd::stream::encode_all(b"jello".as_slice(), 3).unwrap(),
        )
        .unwrap();
        assert!(store.materialize(metadata).await.is_err());
    }

    #[test]
    fn filenames_cannot_escape_the_materialization_directory() {
        for (input, expected) in [
            ("../../file.pdf", "file.pdf"),
            ("C:\\folder\\file.pdf", "file.pdf"),
            ("..", "resource"),
            ("CON.txt", "resource"),
            ("", "resource"),
            ("a\r\nb.txt", "a__b.txt"),
        ] {
            assert_eq!(super::safe_filename(input), expected);
        }
    }
}
