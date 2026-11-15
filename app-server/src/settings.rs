#[derive(clap::Parser)]
#[command(version)]
pub struct Arguments {
    #[command(subcommand)]
    pub command: Option<Command>,
    #[arg(long, default_value = "127.0.0.1:8787")]
    pub listen: Loopback,
    #[arg(long)]
    pub data_dir: Option<std::path::PathBuf>,
    #[arg(long)]
    pub state_dir: Option<std::path::PathBuf>,
    #[arg(long)]
    pub cache_dir: Option<std::path::PathBuf>,
    #[arg(long)]
    pub temp_dir: Option<std::path::PathBuf>,
    #[arg(long, default_value = "4", value_parser = parse_concurrency)]
    pub concurrency: std::num::NonZeroU8,
    #[arg(long)]
    pub chrome: Option<std::path::PathBuf>,
    #[arg(long = "worker")]
    pub browser_worker: Option<std::path::PathBuf>,
    #[arg(long)]
    pub user_browser: Option<std::path::PathBuf>,
    #[arg(long, default_value = "2m", value_parser = parse_positive_duration)]
    pub job_timeout: std::time::Duration,
}

#[derive(clap::Subcommand)]
pub enum Command {
    Openapi {
        #[arg(long)]
        out: Option<std::path::PathBuf>,
    },
}

#[derive(Clone, Copy, Debug)]
pub struct Loopback(std::net::SocketAddr);

impl std::str::FromStr for Loopback {
    type Err = String;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        let value = value
            .strip_prefix("localhost:")
            .map_or_else(|| value.to_owned(), |port| format!("127.0.0.1:{port}"));
        let address = value
            .parse::<std::net::SocketAddr>()
            .map_err(|_| "Invalid listen address")?;
        if !address.ip().is_loopback() {
            return Err("The listen address must be loopback".into());
        }
        Ok(Self(address))
    }
}

impl Loopback {
    pub fn address(self) -> std::net::SocketAddr {
        self.0
    }
}

fn parse_concurrency(value: &str) -> Result<std::num::NonZeroU8, String> {
    value
        .parse::<u8>()
        .ok()
        .filter(|value| *value <= 32)
        .and_then(std::num::NonZeroU8::new)
        .ok_or_else(|| "Concurrency must be between 1 and 32".into())
}

fn parse_positive_duration(value: &str) -> Result<std::time::Duration, String> {
    let duration = humantime::parse_duration(value).map_err(|error| error.to_string())?;
    if duration.is_zero() {
        return Err("The job timeout must be positive".into());
    }
    Ok(duration)
}

pub struct Directories {
    pub data: std::path::PathBuf,
    pub state: std::path::PathBuf,
    pub cache: std::path::PathBuf,
    pub temporary: std::path::PathBuf,
}

impl Directories {
    pub fn defaults() -> Result<Self, std::io::Error> {
        let base = directories::BaseDirs::new().ok_or_else(|| {
            std::io::Error::new(
                std::io::ErrorKind::NotFound,
                "Could not locate the home directory",
            )
        })?;
        Ok(Self::for_platform(
            std::env::consts::OS,
            base.home_dir(),
            &std::env::temp_dir(),
            |name| std::env::var_os(name).map(std::path::PathBuf::from),
        ))
    }

    pub fn for_platform(
        platform: &str,
        home: &std::path::Path,
        temporary: &std::path::Path,
        environment: impl Fn(&str) -> Option<std::path::PathBuf>,
    ) -> Self {
        let app = |base: std::path::PathBuf| base.join("ku-potato").join("server");
        let directory = |name: &str, fallback: std::path::PathBuf| {
            environment(name)
                .filter(|path| path.is_absolute())
                .unwrap_or(fallback)
        };
        match platform {
            "windows" => {
                let base = app(directory("LOCALAPPDATA", home.join("AppData/Local")));
                Self {
                    data: base.join("data"),
                    state: base.join("state"),
                    cache: base.join("cache"),
                    temporary: temporary.to_path_buf(),
                }
            }
            "macos" => {
                let base = app(home.join("Library/Application Support"));
                Self {
                    data: base.join("data"),
                    state: base.join("state"),
                    cache: app(home.join("Library/Caches")),
                    temporary: temporary.to_path_buf(),
                }
            }
            _ => Self {
                data: app(directory("XDG_DATA_HOME", home.join(".local/share"))),
                state: app(directory("XDG_STATE_HOME", home.join(".local/state"))),
                cache: app(directory("XDG_CACHE_HOME", home.join(".cache"))),
                temporary: temporary.to_path_buf(),
            },
        }
    }
}

pub fn create_private_directory(path: &std::path::Path) -> Result<(), std::io::Error> {
    std::fs::create_dir_all(path)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt as _;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700))?;
    }
    Ok(())
}

pub fn acquire_server_lock(state: &std::path::Path) -> Result<std::fs::File, std::io::Error> {
    create_private_directory(state)?;
    let file = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(state.join("server.lock"))?;
    file.try_lock().map_err(|error| match error {
        std::fs::TryLockError::WouldBlock => std::io::Error::new(
            std::io::ErrorKind::AlreadyExists,
            "Another ku-potato server is already running for this OS user",
        ),
        std::fs::TryLockError::Error(error) => error,
    })?;
    Ok(file)
}

#[cfg(test)]
mod tests {
    use clap::Parser as _;

    #[test]
    fn unsafe_listen_addresses_and_invalid_limits_are_rejected() {
        for value in [
            "0.0.0.0:8787",
            "[::]:8787",
            "192.0.2.1:8787",
            "example.com:8787",
            "localhost",
        ] {
            assert!(super::Arguments::try_parse_from(["server", "--listen", value]).is_err());
        }
        for value in ["127.0.0.1:0", "[::1]:8787", "localhost:8787"] {
            assert!(super::Arguments::try_parse_from(["server", "--listen", value]).is_ok());
        }
        for value in ["0", "33", "-1"] {
            assert!(super::Arguments::try_parse_from(["server", "--concurrency", value]).is_err());
        }
        for value in ["0s", "-1s", "invalid"] {
            assert!(super::Arguments::try_parse_from(["server", "--job-timeout", value]).is_err());
        }
        assert!(super::Arguments::try_parse_from(["server", "--job-timeout", "2m"]).is_ok());
    }

    #[test]
    fn directories_match_desktop_defaults() {
        let home = std::path::Path::new("/home/user");
        let temporary = std::path::Path::new("/tmp");
        let directories = super::Directories::for_platform("linux", home, temporary, |_| None);
        assert_eq!(directories.data, home.join(".local/share/ku-potato/server"));
        assert_eq!(
            directories.state,
            home.join(".local/state/ku-potato/server")
        );
        assert_eq!(directories.cache, home.join(".cache/ku-potato/server"));
        let custom = tempfile::tempdir().unwrap();
        let directories = super::Directories::for_platform("linux", home, temporary, |name| {
            Some(if name == "XDG_DATA_HOME" {
                custom.path().to_path_buf()
            } else {
                "relative".into()
            })
        });
        assert_eq!(directories.data, custom.path().join("ku-potato/server"));
        assert_eq!(
            directories.state,
            home.join(".local/state/ku-potato/server")
        );
        let directories = super::Directories::for_platform("macos", home, temporary, |_| None);
        assert_eq!(
            directories.data,
            home.join("Library/Application Support/ku-potato/server/data")
        );
        assert_eq!(
            directories.cache,
            home.join("Library/Caches/ku-potato/server")
        );
        assert_eq!(
            directories.state,
            home.join("Library/Application Support/ku-potato/server/state")
        );
        assert_eq!(directories.temporary, temporary);
        let directories = super::Directories::for_platform("windows", home, temporary, |_| None);
        assert_eq!(
            directories.data,
            home.join("AppData/Local/ku-potato/server/data")
        );
        assert_eq!(
            directories.state,
            home.join("AppData/Local/ku-potato/server/state")
        );
        assert_eq!(
            directories.cache,
            home.join("AppData/Local/ku-potato/server/cache")
        );
        assert_eq!(directories.temporary, temporary);
        let directories = super::Directories::for_platform("windows", home, temporary, |_| {
            Some(custom.path().to_path_buf())
        });
        assert_eq!(
            directories.data,
            custom.path().join("ku-potato/server/data")
        );
        assert_eq!(
            directories.state,
            custom.path().join("ku-potato/server/state")
        );
        assert_eq!(
            directories.cache,
            custom.path().join("ku-potato/server/cache")
        );
    }

    #[test]
    fn server_lock_is_exclusive_and_released_on_drop() {
        let directory = tempfile::tempdir().unwrap();
        let lock = super::acquire_server_lock(directory.path()).unwrap();
        assert!(super::acquire_server_lock(directory.path()).is_err());
        drop(lock);
        assert!(super::acquire_server_lock(directory.path()).is_ok());
    }
}
