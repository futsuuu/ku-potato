use tokio::io::AsyncBufReadExt as _;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Transport(#[from] tonic::transport::Error),
    #[error("The browser service did not report its endpoint in time")]
    StartupTimeout,
    #[error("Invalid browser service handshake: {0}")]
    InvalidHandshake(&'static str),
    #[error("Invalid browser service authentication token: {0}")]
    InvalidToken(#[from] tonic::metadata::errors::InvalidMetadataValue),
}

#[derive(Clone, Copy, Debug)]
pub enum Service {
    BrowserWorker,
    UserBrowser,
}

struct Configuration {
    executable_name: &'static str,
    token_environment: &'static str,
    token_header: &'static str,
}

pub struct Child {
    process: tokio::process::Child,
    input: Option<tokio::process::ChildStdin>,
    pub connection: crate::rpc::Connection,
}

impl Child {
    pub async fn start(
        service: Service,
        executable: Option<&std::path::Path>,
        arguments: &[String],
    ) -> Result<Self, Error> {
        let configuration = match service {
            Service::BrowserWorker => Configuration {
                executable_name: "ku-potato-browser-worker",
                token_environment: "KU_POTATO_WORKER_TOKEN",
                token_header: "x-ku-potato-worker-token",
            },
            Service::UserBrowser => Configuration {
                executable_name: "ku-potato-user-browser",
                token_environment: "KU_POTATO_USER_BROWSER_TOKEN",
                token_header: "x-ku-potato-user-browser-token",
            },
        };
        let executable = match executable {
            Some(path) => path.to_path_buf(),
            None => std::env::current_exe()?.with_file_name(format!(
                "{}{}",
                configuration.executable_name,
                std::env::consts::EXE_SUFFIX
            )),
        };
        #[cfg(windows)]
        let executable = if executable
            .extension()
            .is_none_or(|extension| extension != "exe")
        {
            executable.with_extension("exe")
        } else {
            executable
        };
        let secret = format!(
            "{}{}",
            uuid::Uuid::new_v4().simple(),
            uuid::Uuid::new_v4().simple()
        );
        let mut command = tokio::process::Command::new(executable);
        command
            .args(arguments)
            .env(configuration.token_environment, &secret)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::inherit())
            .kill_on_drop(true);
        #[cfg(windows)]
        command.creation_flags(0x08000000);
        let mut process = command.spawn()?;
        let input = process.stdin.take();
        let output = process
            .stdout
            .take()
            .ok_or(Error::InvalidHandshake("child stdout"))?;
        let mut reader = tokio::io::BufReader::new(output);
        let mut line = String::new();
        tokio::time::timeout(
            std::time::Duration::from_secs(15),
            reader.read_line(&mut line),
        )
        .await
        .map_err(|_| Error::StartupTimeout)??;
        let endpoint: std::net::SocketAddr = line
            .trim()
            .parse()
            .map_err(|_| Error::InvalidHandshake("child endpoint"))?;
        if endpoint.ip() != std::net::Ipv4Addr::LOCALHOST || endpoint.port() == 0 {
            return Err(Error::InvalidHandshake(
                "child endpoint must be IPv4 loopback",
            ));
        }
        tokio::spawn(async move {
            let _ = tokio::io::copy(&mut reader, &mut tokio::io::sink()).await;
        });
        let channel = tonic::transport::Endpoint::from_shared(format!("http://{endpoint}"))?
            .connect_timeout(std::time::Duration::from_secs(15))
            .connect()
            .await?;
        Ok(Self {
            process,
            input,
            connection: crate::rpc::Connection {
                channel,
                token: crate::rpc::Token::new(configuration.token_header, &secret)?,
            },
        })
    }

    pub async fn wait(&mut self) -> Result<std::process::ExitStatus, std::io::Error> {
        self.process.wait().await
    }

    pub async fn shutdown(&mut self) -> Result<(), std::io::Error> {
        self.input.take();
        match tokio::time::timeout(std::time::Duration::from_secs(15), self.process.wait()).await {
            Ok(result) => {
                result?;
            }
            Err(_) => {
                self.process.kill().await?;
                self.process.wait().await?;
            }
        }
        Ok(())
    }
}
