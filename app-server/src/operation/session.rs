impl super::Coordinator {
    async fn refresh_lms_session(&self, renew: bool) -> Result<(), super::Error> {
        let _guard = self.session_refresh.lock().await;
        let cookies = self.user_browser.sso_cookies(renew).await?;
        let cookies = cookies
            .into_iter()
            .map(|cookie| crate::browser_worker::protocol::Cookie {
                name: cookie.name,
                value: cookie.value,
                domain: cookie.domain,
                path: cookie.path,
                secure: cookie.secure,
                http_only: cookie.http_only,
                same_site: cookie.same_site,
                expires: cookie.expires,
                priority: cookie.priority,
                source_scheme: cookie.source_scheme,
                source_port: cookie.source_port,
                partition_key: cookie.partition_key.map(|key| {
                    crate::browser_worker::protocol::PartitionKey {
                        top_level_site: key.top_level_site,
                        has_cross_site_ancestor: key.has_cross_site_ancestor,
                    }
                }),
            })
            .collect();
        self.browser_worker.set_sso_cookies(cookies).await?;
        Ok(())
    }

    pub(super) async fn with_lms_session<T, F, Fut>(&self, mut run: F) -> Result<T, super::Error>
    where
        F: FnMut() -> Fut,
        Fut: std::future::Future<Output = Result<T, crate::browser_worker::Error>>,
    {
        for attempt in 0..3 {
            match run().await {
                Err(crate::browser_worker::Error::AuthenticationRequired) if attempt < 2 => {
                    self.refresh_lms_session(attempt == 1).await?;
                }
                result => return result.map_err(super::Error::from),
            }
        }
        Err(crate::browser_worker::Error::AuthenticationRequired.into())
    }
}

#[tokio::test]
async fn authentication_retries_forward_typed_cookies_and_renew_once() {
    let fixture = crate::rpc::tests::Fixture::new().await;
    fixture
        .service
        .require_renewal
        .store(true, std::sync::atomic::Ordering::SeqCst);
    let operations = fixture.operations().await;
    operations
        .with_lms_session(|| operations.browser_worker.fetch_courses())
        .await
        .unwrap();
    assert_eq!(
        fixture
            .service
            .courses_calls
            .load(std::sync::atomic::Ordering::SeqCst),
        3
    );
    assert_eq!(
        fixture
            .service
            .cookie_calls
            .load(std::sync::atomic::Ordering::SeqCst),
        2
    );
}

#[tokio::test]
async fn authentication_retries_stop_after_one_renewal() {
    let fixture = crate::rpc::tests::Fixture::new().await;
    let operations = fixture.operations().await;
    let mut attempts = 0;
    let result = operations
        .with_lms_session(|| {
            attempts += 1;
            std::future::ready(Err::<(), _>(
                crate::browser_worker::Error::AuthenticationRequired,
            ))
        })
        .await;
    assert!(matches!(
        result,
        Err(crate::operation::Error::BrowserWorker(
            crate::browser_worker::Error::AuthenticationRequired
        ))
    ));
    assert_eq!(attempts, 3);
    assert_eq!(
        fixture
            .service
            .cookie_calls
            .load(std::sync::atomic::Ordering::SeqCst),
        2
    );
    assert!(
        fixture
            .service
            .renewed
            .load(std::sync::atomic::Ordering::SeqCst)
    );
}

#[tokio::test]
async fn success_and_non_authentication_failures_do_not_request_cookies() {
    let fixture = crate::rpc::tests::Fixture::new().await;
    let operations = fixture.operations().await;
    assert_eq!(
        operations
            .with_lms_session(|| std::future::ready(Ok::<_, crate::browser_worker::Error>(
                "completed"
            )))
            .await
            .unwrap(),
        "completed"
    );
    let mut attempts = 0;
    let result = operations
        .with_lms_session(|| {
            attempts += 1;
            std::future::ready(Err::<(), _>(crate::browser_worker::Error::Source {
                message: "Source unavailable".into(),
            }))
        })
        .await;
    assert!(matches!(
        result,
        Err(crate::operation::Error::BrowserWorker(
            crate::browser_worker::Error::Source { .. }
        ))
    ));
    assert_eq!(attempts, 1);
    assert_eq!(
        fixture
            .service
            .cookie_calls
            .load(std::sync::atomic::Ordering::SeqCst),
        0
    );
}
