use clap::Parser as _;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let arguments = ku_potato_server::settings::Arguments::parse();
    if let Some(ku_potato_server::settings::Command::Openapi { out }) = arguments.command {
        let document = format!(
            "{}\n",
            serde_json::to_string_pretty(&ku_potato_server::http::openapi())?
        );
        if let Some(out) = out {
            std::fs::write(out, document)?;
        } else {
            print!("{document}");
        }
        return Ok(());
    }
    let defaults = ku_potato_server::settings::Directories::defaults()?;
    let _lock = ku_potato_server::settings::acquire_server_lock(&defaults.state)?;
    let directory = arguments
        .state_dir
        .as_deref()
        .unwrap_or(&defaults.state)
        .join("telemetry");
    let providers = ku_potato_server::telemetry::init_telemetry(&directory)?;
    let result = run_server(arguments, defaults).await;
    if let Err(error) = &result {
        tracing::error!(error = %error, "Server failed");
    }
    tokio::task::spawn_blocking(|| providers.shutdown()).await??;
    result
}

enum ServerExit {
    Completed(Result<(), std::io::Error>),
    Interrupted(Result<(), std::io::Error>),
}

async fn run_server(
    arguments: ku_potato_server::settings::Arguments,
    defaults: ku_potato_server::settings::Directories,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let data = arguments.data_dir.unwrap_or(defaults.data);
    let state = arguments.state_dir.unwrap_or(defaults.state);
    let cache = arguments.cache_dir.unwrap_or(defaults.cache);
    let temporary = arguments.temp_dir.unwrap_or(defaults.temporary);
    for directory in [&data, &state, &cache] {
        ku_potato_server::settings::create_private_directory(directory)?;
    }
    std::fs::create_dir_all(&temporary)?;
    let temporary = temporary.canonicalize()?;
    let process_temporary = tempfile::Builder::new()
        .prefix("ku-potato-server-")
        .tempdir_in(&temporary)?;
    let data = data.canonicalize()?;
    let archive = ku_potato_server::archive::Store::open_path(&data.join("archive.sqlite")).await?;
    let files = ku_potato_server::files::Store::new(data.join("resources"), &temporary)?;
    let listener = tokio::net::TcpListener::bind(arguments.listen.address()).await?;
    let authority = listener.local_addr()?;
    let chrome = arguments
        .chrome
        .map(|path| path.to_string_lossy().into_owned())
        .unwrap_or_default();
    let mut user_browser = ku_potato_server::process::Child::start(
        ku_potato_server::process::Service::UserBrowser,
        arguments.user_browser.as_deref(),
        &[
            "-telemetry-dir".into(),
            state.join("telemetry").to_string_lossy().into_owned(),
            "-state-dir".into(),
            state.to_string_lossy().into_owned(),
            "-cache-dir".into(),
            cache.join("user-browser").to_string_lossy().into_owned(),
            "-chrome".into(),
            chrome.clone(),
        ],
    )
    .await?;
    let browser_worker = ku_potato_server::process::Child::start(
        ku_potato_server::process::Service::BrowserWorker,
        arguments.browser_worker.as_deref(),
        &[
            "-telemetry-dir".into(),
            state.join("telemetry").to_string_lossy().into_owned(),
            "-temp-dir".into(),
            process_temporary.path().to_string_lossy().into_owned(),
            "-chrome".into(),
            chrome,
            "-concurrency".into(),
            arguments.concurrency.to_string(),
        ],
    )
    .await;
    let mut browser_worker = match browser_worker {
        Ok(browser_worker) => browser_worker,
        Err(error) => {
            user_browser.shutdown().await?;
            return Err(error.into());
        }
    };
    let operations = std::sync::Arc::new(ku_potato_server::operation::Coordinator::new(
        archive,
        files,
        ku_potato_server::browser_worker::Client::new(browser_worker.connection.clone()),
        ku_potato_server::user_browser::Client::new(user_browser.connection.clone()),
        ku_potato_server::operation::Options {
            temporary_directory: process_temporary.path().to_path_buf(),
            job_timeout: arguments.job_timeout,
            course_concurrency: std::num::NonZeroUsize::from(arguments.concurrency),
        },
    ));
    let router = ku_potato_server::http::router(operations.clone(), authority);
    let stop = tokio_util::sync::CancellationToken::new();
    let serving =
        axum::serve(listener, router).with_graceful_shutdown(stop.clone().cancelled_owned());
    let mut serving = Box::pin(std::future::IntoFuture::into_future(serving));
    tracing::info!(url = %format!("http://{authority}"), "HTTP server listening");
    let exit = tokio::select! {
        result = &mut serving => ServerExit::Completed(result),
        result = wait_for_shutdown() => ServerExit::Interrupted(result),
        result = user_browser.wait() => ServerExit::Interrupted(Err(describe_child_exit(
            "User browser",
            result
        ))),
        result = browser_worker.wait() => ServerExit::Interrupted(Err(describe_child_exit(
            "Browser worker",
            result
        ))),
    };
    stop.cancel();
    operations.shutdown().await;
    let result = match exit {
        ServerExit::Completed(result) => result,
        ServerExit::Interrupted(result) => {
            let _ = tokio::time::timeout(std::time::Duration::from_secs(15), &mut serving).await;
            result
        }
    };
    let (user_browser_result, browser_worker_result) =
        tokio::join!(user_browser.shutdown(), browser_worker.shutdown());
    user_browser_result?;
    browser_worker_result?;
    result?;
    Ok(())
}

fn describe_child_exit(
    service: &str,
    result: Result<std::process::ExitStatus, std::io::Error>,
) -> std::io::Error {
    match result {
        Ok(status) => std::io::Error::other(format!("{service} exited: {status}")),
        Err(error) => error,
    }
}

async fn wait_for_shutdown() -> Result<(), std::io::Error> {
    #[cfg(unix)]
    {
        let mut terminate =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())?;
        tokio::select! {
            result = tokio::signal::ctrl_c() => result,
            _ = terminate.recv() => Ok(())
        }
    }
    #[cfg(not(unix))]
    {
        tokio::signal::ctrl_c().await
    }
}
