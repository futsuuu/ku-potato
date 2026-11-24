#[derive(Clone)]
pub struct Token {
    header: tonic::metadata::MetadataKey<tonic::metadata::Ascii>,
    value: tonic::metadata::MetadataValue<tonic::metadata::Ascii>,
}

impl Token {
    pub fn new(
        header: &'static str,
        value: &str,
    ) -> Result<Self, tonic::metadata::errors::InvalidMetadataValue> {
        Ok(Self {
            header: tonic::metadata::MetadataKey::from_static(header),
            value: value.parse()?,
        })
    }
}

impl tonic::service::Interceptor for Token {
    fn call(
        &mut self,
        mut request: tonic::Request<()>,
    ) -> Result<tonic::Request<()>, tonic::Status> {
        request
            .metadata_mut()
            .insert(self.header.clone(), self.value.clone());
        crate::telemetry::inject_context(request.metadata_mut());
        Ok(request)
    }
}

#[derive(Clone)]
pub struct Connection {
    pub channel: tonic::transport::Channel,
    pub token: Token,
}

#[derive(Clone, PartialEq, prost::Message)]
pub(crate) struct Status {
    #[prost(int32, tag = "1")]
    pub code: i32,
    #[prost(string, tag = "2")]
    pub message: String,
    #[prost(message, repeated, tag = "3")]
    pub details: Vec<prost_types::Any>,
}

pub(crate) fn decode_timestamp(
    value: prost_types::Timestamp,
) -> Option<chrono::DateTime<chrono::Utc>> {
    if !(-62_135_596_800..=253_402_300_799).contains(&value.seconds)
        || !(0..1_000_000_000).contains(&value.nanos)
    {
        return None;
    }
    chrono::DateTime::from_timestamp(value.seconds, value.nanos as u32)
}

#[cfg(test)]
pub(crate) mod tests {
    use prost::Message as _;

    #[derive(Default)]
    pub(crate) struct Service {
        pub courses_calls: std::sync::atomic::AtomicUsize,
        pub cookie_calls: std::sync::atomic::AtomicUsize,
        pub require_renewal: std::sync::atomic::AtomicBool,
        pub renewed: std::sync::atomic::AtomicBool,
        pub truncated: std::sync::atomic::AtomicBool,
        pub google_authentication_required: std::sync::atomic::AtomicBool,
    }

    pub(crate) struct Fixture {
        pub service: std::sync::Arc<Service>,
        pub browser_worker: crate::browser_worker::Client,
        pub user_browser: crate::user_browser::Client,
        pub temporary: tempfile::TempDir,
        stop: tokio_util::sync::CancellationToken,
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            self.stop.cancel();
        }
    }

    impl Fixture {
        pub async fn new() -> Self {
            let service = std::sync::Arc::new(Service::default());
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let endpoint = listener.local_addr().unwrap();
            let stop = tokio_util::sync::CancellationToken::new();
            let serving = tonic::transport::Server::builder()
                .add_service(
                    crate::browser_worker::protocol::browser_worker_server::BrowserWorkerServer::from_arc(
                        service.clone(),
                    ),
                )
                .add_service(
                    crate::user_browser::protocol::user_browser_server::UserBrowserServer::from_arc(
                        service.clone(),
                    ),
                )
                .serve_with_incoming_shutdown(
                    tokio_stream::wrappers::TcpListenerStream::new(listener),
                    stop.clone().cancelled_owned(),
                );
            tokio::spawn(serving);
            let channel = tonic::transport::Endpoint::from_shared(format!("http://{endpoint}"))
                .unwrap()
                .connect()
                .await
                .unwrap();
            let temporary = tempfile::tempdir().unwrap();
            let browser_worker = crate::browser_worker::Client::new(super::Connection {
                channel: channel.clone(),
                token: super::Token::new("x-ku-potato-worker-token", "worker-secret").unwrap(),
            });
            let user_browser = crate::user_browser::Client::new(super::Connection {
                channel,
                token: super::Token::new("x-ku-potato-user-browser-token", "user-secret").unwrap(),
            });
            Self {
                service,
                browser_worker,
                user_browser,
                temporary,
                stop,
            }
        }

        pub async fn operations(&self) -> std::sync::Arc<crate::operation::Coordinator> {
            std::sync::Arc::new(crate::operation::Coordinator::new(
                crate::archive::Store::open("sqlite::memory:")
                    .await
                    .unwrap(),
                crate::files::Store::new(
                    self.temporary.path().join("resources"),
                    self.temporary.path(),
                )
                .unwrap(),
                self.browser_worker.clone(),
                self.user_browser.clone(),
                crate::operation::Options {
                    temporary_directory: self.temporary.path().to_path_buf(),
                    job_timeout: std::time::Duration::from_secs(2),
                    course_concurrency: std::num::NonZeroUsize::new(4).unwrap(),
                },
            ))
        }
    }

    pub(crate) fn listing() -> crate::browser_worker::protocol::CourseListing {
        crate::browser_worker::protocol::CourseListing {
            academic_year: 2026,
            courses: vec![crate::browser_worker::protocol::Course {
                name: "Course".into(),
                access: Some(crate::browser_worker::protocol::course::Access::Available(
                    crate::browser_worker::protocol::CourseId {
                        value: "course1".into(),
                    },
                )),
                schedule: Some(
                    crate::browser_worker::protocol::course::Schedule::Scheduled(
                        crate::browser_worker::protocol::Schedule {
                            weekday: 1,
                            period: 2,
                        },
                    ),
                ),
            }],
        }
    }

    pub(crate) fn snapshot() -> crate::browser_worker::protocol::Snapshot {
        crate::browser_worker::protocol::Snapshot {
            academic_year: 2026,
            courses: listing().courses,
            course_materials: Some(crate::browser_worker::protocol::CourseMaterials {
                course_id: Some(crate::browser_worker::protocol::CourseId {
                    value: "course1".into(),
                }),
                folders: vec![crate::browser_worker::protocol::Folder {
                    name: "Week 1".into(),
                    materials: vec![crate::browser_worker::protocol::Material {
                        id: Some(crate::browser_worker::protocol::MaterialId {
                            value: "MAT1".into(),
                        }),
                        name: "Material".into(),
                        publication_deadline: Some(crate::browser_worker::protocol::PublicationDeadline {
                            value: Some(
                                crate::browser_worker::protocol::publication_deadline::Value::Unlisted(()),
                            ),
                        }),
                        material_link_available: true,
                        kind: Some(crate::browser_worker::protocol::material::Kind::Document(
                            crate::browser_worker::protocol::DocumentMaterial {
                                status: crate::browser_worker::protocol::DocumentStatus::Unviewed.into(),
                                resource_availability:
                                    crate::browser_worker::protocol::LinkAvailability::Available.into(),
                            },
                        )),
                    }],
                    ..Default::default()
                }],
            }),
            material_id: Some(crate::browser_worker::protocol::MaterialId {
                value: "MAT1".into(),
            }),
            resource_list: Some(crate::browser_worker::protocol::ResourceList {
                resources: vec![crate::browser_worker::protocol::Resource {
                    id: Some(crate::browser_worker::protocol::ResourceId {
                        value: "SRS1".into(),
                    }),
                    name: "File".into(),
                    status: crate::browser_worker::protocol::ResourceStatus::Viewed.into(),
                    content: Some(crate::browser_worker::protocol::resource::Content::File(
                        crate::browser_worker::protocol::ResourceFile {
                            url: "https://example.com/download".into(),
                        },
                    )),
                    ..Default::default()
                }],
            }),
            report: None,
        }
    }

    fn check<T>(
        request: &tonic::Request<T>,
        header: &'static str,
        secret: &str,
    ) -> Result<(), tonic::Status> {
        if request
            .metadata()
            .get(header)
            .is_none_or(|value| value != secret)
        {
            return Err(tonic::Status::unauthenticated("Missing process token"));
        }
        Ok(())
    }

    fn authentication_required() -> tonic::Status {
        let failure = crate::browser_worker::protocol::Failure {
            reason: crate::browser_worker::protocol::FailureReason::AuthenticationRequired.into(),
            message: "Login required".into(),
            target: None,
        };
        let status = super::Status {
            code: tonic::Code::FailedPrecondition as i32,
            message: "Login required".into(),
            details: vec![prost_types::Any {
                type_url: "type.googleapis.com/kupotato.browserworker.v1.Failure".into(),
                value: failure.encode_to_vec(),
            }],
        };
        tonic::Status::with_details(
            tonic::Code::FailedPrecondition,
            "Login required",
            status.encode_to_vec().into(),
        )
    }

    #[tonic::async_trait]
    impl crate::browser_worker::protocol::browser_worker_server::BrowserWorker for Service {
        async fn courses(
            &self,
            request: tonic::Request<()>,
        ) -> Result<tonic::Response<crate::browser_worker::protocol::CourseListing>, tonic::Status>
        {
            check(&request, "x-ku-potato-worker-token", "worker-secret")?;
            self.courses_calls
                .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
            if self
                .require_renewal
                .load(std::sync::atomic::Ordering::SeqCst)
                && !self.renewed.load(std::sync::atomic::Ordering::SeqCst)
            {
                return Err(authentication_required());
            }
            Ok(tonic::Response::new(listing()))
        }

        async fn materials(
            &self,
            request: tonic::Request<crate::browser_worker::protocol::MaterialsRequest>,
        ) -> Result<tonic::Response<crate::browser_worker::protocol::Snapshot>, tonic::Status>
        {
            check(&request, "x-ku-potato-worker-token", "worker-secret")?;
            let mut value = snapshot();
            value.material_id = None;
            value.resource_list = None;
            Ok(tonic::Response::new(value))
        }

        async fn resources(
            &self,
            request: tonic::Request<crate::browser_worker::protocol::ResourcesRequest>,
        ) -> Result<tonic::Response<crate::browser_worker::protocol::Snapshot>, tonic::Status>
        {
            check(&request, "x-ku-potato-worker-token", "worker-secret")?;
            Ok(tonic::Response::new(snapshot()))
        }

        type DownloadStream = tokio_stream::Iter<
            std::vec::IntoIter<
                Result<crate::browser_worker::protocol::DownloadPart, tonic::Status>,
            >,
        >;

        async fn download(
            &self,
            request: tonic::Request<crate::browser_worker::protocol::DownloadRequest>,
        ) -> Result<tonic::Response<Self::DownloadStream>, tonic::Status> {
            check(&request, "x-ku-potato-worker-token", "worker-secret")?;
            if self
                .google_authentication_required
                .load(std::sync::atomic::Ordering::SeqCst)
            {
                return Ok(tonic::Response::new(tokio_stream::iter(vec![Ok(
                    crate::browser_worker::protocol::DownloadPart {
                        part: Some(crate::browser_worker::protocol::download_part::Part::Header(
                            crate::browser_worker::protocol::DownloadHeader {
                                snapshot: Some(snapshot()),
                                outcome: Some(
                                    crate::browser_worker::protocol::download_header::Outcome::ExternalUrl(
                                        "https://drive.google.com/file/d/example/view".into(),
                                    ),
                                ),
                            },
                        )),
                    },
                )])));
            }
            let mut parts = vec![Ok(crate::browser_worker::protocol::DownloadPart {
                part: Some(
                    crate::browser_worker::protocol::download_part::Part::Header(
                        crate::browser_worker::protocol::DownloadHeader {
                            snapshot: Some(snapshot()),
                            outcome: Some(
                                crate::browser_worker::protocol::download_header::Outcome::File(
                                    crate::browser_worker::protocol::FileDownload {
                                        filename: "file.txt".into(),
                                        byte_size: 5,
                                    },
                                ),
                            ),
                        },
                    ),
                ),
            })];
            if !self.truncated.load(std::sync::atomic::Ordering::SeqCst) {
                parts.push(Ok(crate::browser_worker::protocol::DownloadPart {
                    part: Some(crate::browser_worker::protocol::download_part::Part::Chunk(
                        b"hello".to_vec(),
                    )),
                }));
            }
            Ok(tonic::Response::new(tokio_stream::iter(parts)))
        }

        async fn set_sso_cookies(
            &self,
            request: tonic::Request<crate::browser_worker::protocol::SsoCookies>,
        ) -> Result<tonic::Response<()>, tonic::Status> {
            check(&request, "x-ku-potato-worker-token", "worker-secret")?;
            let cookies = request.into_inner().cookies;
            let renewed = cookies.iter().any(|cookie| cookie.value == "renewed");
            assert_eq!(
                cookies,
                vec![crate::browser_worker::protocol::Cookie {
                    name: "session".into(),
                    value: if renewed { "renewed" } else { "stale" }.into(),
                    domain: ".example.com".into(),
                    path: "/session".into(),
                    secure: true,
                    http_only: true,
                    same_site: crate::browser_worker::protocol::CookieSameSite::Lax.into(),
                    expires: Some(prost_types::Timestamp {
                        seconds: 2_000_000_000,
                        nanos: 123_000_000
                    }),
                    priority: crate::browser_worker::protocol::CookiePriority::High.into(),
                    source_scheme: crate::browser_worker::protocol::CookieSourceScheme::Secure
                        .into(),
                    source_port: 443,
                    partition_key: Some(crate::browser_worker::protocol::PartitionKey {
                        top_level_site: "https://example.com".into(),
                        has_cross_site_ancestor: true,
                    }),
                }]
            );
            self.renewed
                .store(renewed, std::sync::atomic::Ordering::SeqCst);
            Ok(tonic::Response::new(()))
        }
    }

    #[tonic::async_trait]
    impl crate::user_browser::protocol::user_browser_server::UserBrowser for Service {
        async fn login(
            &self,
            request: tonic::Request<crate::user_browser::protocol::LoginRequest>,
        ) -> Result<tonic::Response<()>, tonic::Status> {
            check(&request, "x-ku-potato-user-browser-token", "user-secret")?;
            Ok(tonic::Response::new(()))
        }

        async fn status(
            &self,
            _: tonic::Request<crate::user_browser::protocol::ProviderRequest>,
        ) -> Result<
            tonic::Response<crate::user_browser::protocol::AuthenticationStatus>,
            tonic::Status,
        > {
            Ok(tonic::Response::new(
                crate::user_browser::protocol::AuthenticationStatus {
                    authenticated: true,
                },
            ))
        }

        async fn register_web_authn(
            &self,
            _: tonic::Request<crate::user_browser::protocol::InteractiveRequest>,
        ) -> Result<tonic::Response<()>, tonic::Status> {
            Ok(tonic::Response::new(()))
        }
        async fn web_authn_registration_status(
            &self,
            _: tonic::Request<()>,
        ) -> Result<tonic::Response<crate::user_browser::protocol::RegistrationStatus>, tonic::Status>
        {
            Ok(tonic::Response::new(
                crate::user_browser::protocol::RegistrationStatus { registered: true },
            ))
        }
        async fn delete_web_authn(
            &self,
            _: tonic::Request<()>,
        ) -> Result<tonic::Response<()>, tonic::Status> {
            Ok(tonic::Response::new(()))
        }
        async fn sso_cookies(
            &self,
            request: tonic::Request<crate::user_browser::protocol::SsoCookiesRequest>,
        ) -> Result<tonic::Response<crate::user_browser::protocol::Cookies>, tonic::Status>
        {
            check(&request, "x-ku-potato-user-browser-token", "user-secret")?;
            self.cookie_calls
                .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            Ok(tonic::Response::new(
                crate::user_browser::protocol::Cookies {
                    cookies: vec![crate::user_browser::protocol::Cookie {
                        name: "session".into(),
                        value: if request.into_inner().renew {
                            "renewed"
                        } else {
                            "stale"
                        }
                        .into(),
                        domain: ".example.com".into(),
                        path: "/session".into(),
                        secure: true,
                        http_only: true,
                        same_site: crate::user_browser::protocol::CookieSameSite::Lax.into(),
                        expires: Some(prost_types::Timestamp {
                            seconds: 2_000_000_000,
                            nanos: 123_000_000,
                        }),
                        priority: crate::user_browser::protocol::CookiePriority::High.into(),
                        source_scheme: crate::user_browser::protocol::CookieSourceScheme::Secure
                            .into(),
                        source_port: 443,
                        partition_key: Some(crate::user_browser::protocol::PartitionKey {
                            top_level_site: "https://example.com".into(),
                            has_cross_site_ancestor: true,
                        }),
                    }],
                },
            ))
        }
        async fn google_cookies(
            &self,
            _: tonic::Request<()>,
        ) -> Result<tonic::Response<crate::user_browser::protocol::Cookies>, tonic::Status>
        {
            if self
                .google_authentication_required
                .load(std::sync::atomic::Ordering::SeqCst)
            {
                let failure = crate::user_browser::protocol::Failure {
                    reason: crate::user_browser::protocol::FailureReason::AuthenticationRequired
                        .into(),
                    message: "Google login required".into(),
                };
                let status = super::Status {
                    code: tonic::Code::FailedPrecondition as i32,
                    message: failure.message.clone(),
                    details: vec![prost_types::Any {
                        type_url: "type.googleapis.com/kupotato.userbrowser.v1.Failure".into(),
                        value: failure.encode_to_vec(),
                    }],
                };
                return Err(tonic::Status::with_details(
                    tonic::Code::FailedPrecondition,
                    "Google login required",
                    status.encode_to_vec().into(),
                ));
            }
            Ok(tonic::Response::new(
                crate::user_browser::protocol::Cookies::default(),
            ))
        }
    }
}
