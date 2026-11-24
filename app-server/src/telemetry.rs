mod file;

use opentelemetry::trace::TracerProvider as _;
use tracing::Instrument as _;
use tracing_opentelemetry::OpenTelemetrySpanExt as _;
use tracing_subscriber::Layer as _;
use tracing_subscriber::layer::SubscriberExt as _;
use tracing_subscriber::util::SubscriberInitExt as _;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Subscriber(#[from] tracing_subscriber::util::TryInitError),
}

pub struct Providers {
    traces: opentelemetry_sdk::trace::SdkTracerProvider,
    metrics: opentelemetry_sdk::metrics::SdkMeterProvider,
    logs: opentelemetry_sdk::logs::SdkLoggerProvider,
}

pub fn init_telemetry(directory: &std::path::Path) -> Result<Providers, Error> {
    crate::settings::create_private_directory(directory)?;
    let instance_id = uuid::Uuid::new_v4();
    let directory = directory.join(format!("app-server-{instance_id}"));
    crate::settings::create_private_directory(&directory)?;
    let filter = tracing_subscriber::EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| "ku_potato_server=info".into());
    let resource = create_resource(instance_id);
    let trace_exporter = file::Exporter::create_file(&directory.join("traces.jsonl"), &resource)?;
    let metric_exporter = file::Exporter::create_file(&directory.join("metrics.jsonl"), &resource)?;
    let log_exporter = file::Exporter::create_file(&directory.join("logs.jsonl"), &resource)?;
    let providers = Providers {
        traces: opentelemetry_sdk::trace::SdkTracerProvider::builder()
            .with_resource(resource.clone())
            .with_batch_exporter(trace_exporter)
            .build(),
        metrics: opentelemetry_sdk::metrics::SdkMeterProvider::builder()
            .with_resource(resource.clone())
            .with_reader(
                opentelemetry_sdk::metrics::PeriodicReader::builder(metric_exporter)
                    .with_interval(std::time::Duration::from_secs(10))
                    .build(),
            )
            .build(),
        logs: opentelemetry_sdk::logs::SdkLoggerProvider::builder()
            .with_resource(resource)
            .with_batch_exporter(log_exporter)
            .build(),
    };
    opentelemetry::global::set_meter_provider(providers.metrics.clone());
    opentelemetry::global::set_text_map_propagator(
        opentelemetry_sdk::propagation::TraceContextPropagator::new(),
    );
    let application = tracing_subscriber::filter::Targets::new().with_target(
        "ku_potato_server",
        tracing::level_filters::LevelFilter::TRACE,
    );
    tracing_subscriber::registry()
        .with(filter)
        .with(tracing_subscriber::fmt::layer().with_writer(std::io::stderr))
        .with(
            tracing_opentelemetry::layer()
                .with_tracer(providers.traces.tracer("ku-potato-server"))
                .with_filter(application.clone()),
        )
        .with(
            opentelemetry_appender_tracing::layer::OpenTelemetryTracingBridge::new(&providers.logs)
                .with_filter(application),
        )
        .try_init()?;
    tracing::info!(directory = %directory.display(), "Telemetry recording");
    Ok(providers)
}

fn create_resource(instance_id: uuid::Uuid) -> opentelemetry_sdk::Resource {
    opentelemetry_sdk::Resource::builder()
        .with_service_name("app-server")
        .with_attribute(opentelemetry::KeyValue::new(
            "service.instance.id",
            instance_id.to_string(),
        ))
        .with_attribute(opentelemetry::KeyValue::new(
            "service.version",
            env!("CARGO_PKG_VERSION"),
        ))
        .with_attribute(opentelemetry::KeyValue::new(
            "process.pid",
            i64::from(std::process::id()),
        ))
        .build()
}

impl Providers {
    pub fn shutdown(self) -> Result<(), opentelemetry_sdk::error::OTelSdkError> {
        let traces = self.traces.shutdown();
        let metrics = self.metrics.shutdown();
        let logs = self.logs.shutdown();
        traces.and(metrics).and(logs)
    }
}

struct HeaderExtractor<'a>(&'a axum::http::HeaderMap);

impl opentelemetry::propagation::Extractor for HeaderExtractor<'_> {
    fn get(&self, key: &str) -> Option<&str> {
        self.0.get(key)?.to_str().ok()
    }

    fn keys(&self) -> Vec<&str> {
        self.0.keys().map(axum::http::HeaderName::as_str).collect()
    }
}

struct MetadataInjector<'a>(&'a mut tonic::metadata::MetadataMap);

impl opentelemetry::propagation::Injector for MetadataInjector<'_> {
    fn set(&mut self, key: &str, value: String) {
        if let (Ok(key), Ok(value)) = (
            key.parse::<tonic::metadata::MetadataKey<tonic::metadata::Ascii>>(),
            value.parse::<tonic::metadata::MetadataValue<tonic::metadata::Ascii>>(),
        ) {
            self.0.insert(key, value);
        }
    }
}

pub fn inject_context(metadata: &mut tonic::metadata::MetadataMap) {
    opentelemetry::global::get_text_map_propagator(|propagator| {
        propagator.inject_context(
            &tracing::Span::current().context(),
            &mut MetadataInjector(metadata),
        );
    });
}

pub async fn observe_http(
    request: axum::extract::Request,
    next: axum::middleware::Next,
) -> axum::response::Response {
    let method = request.method().as_str().to_owned();
    let route = request
        .extensions()
        .get::<axum::extract::MatchedPath>()
        .map_or("unmatched", axum::extract::MatchedPath::as_str)
        .to_owned();
    let parent = opentelemetry::global::get_text_map_propagator(|propagator| {
        propagator.extract(&HeaderExtractor(request.headers()))
    });
    let span = tracing::info_span!(
        "http.server",
        otel.name = %format!("{method} {route}"),
        otel.kind = "server",
        http.request.method = %method,
        http.route = %route,
        http.response.status_code = tracing::field::Empty,
        otel.status_code = tracing::field::Empty,
    );
    let _ = span.set_parent(parent);
    async move {
        let start = std::time::Instant::now();
        let response = next.run(request).await;
        let status = response.status().as_u16();
        let span = tracing::Span::current();
        span.record("http.response.status_code", status);
        if response.status().is_server_error() {
            span.record("otel.status_code", "ERROR");
        }
        let attributes = [
            opentelemetry::KeyValue::new("http.request.method", method),
            opentelemetry::KeyValue::new("http.route", route),
            opentelemetry::KeyValue::new("http.response.status_code", i64::from(status)),
        ];
        opentelemetry::global::meter("ku-potato-server")
            .f64_histogram("http.server.request.duration")
            .with_unit("s")
            .with_boundaries(vec![
                0.005, 0.01, 0.025, 0.05, 0.075, 0.1, 0.25, 0.5, 0.75, 1.0, 2.5, 5.0, 7.5, 10.0,
            ])
            .build()
            .record(start.elapsed().as_secs_f64(), &attributes);
        tracing::info!(http.response.status_code = status, "HTTP request completed");
        response
    }
    .instrument(span)
    .await
}

#[cfg(test)]
mod tests {
    use opentelemetry::trace::TracerProvider as _;
    use tonic::service::Interceptor as _;
    use tower::ServiceExt as _;
    use tracing::Instrument as _;
    use tracing::instrument::WithSubscriber as _;
    use tracing_subscriber::layer::SubscriberExt as _;

    #[tokio::test]
    async fn http_context_survives_spawn_and_correlates_rpc_metadata_logs_and_metrics() {
        let directory = tempfile::tempdir().unwrap();
        let instance_id = uuid::Uuid::new_v4();
        let resource = super::create_resource(instance_id);
        let span_exporter = opentelemetry_sdk::trace::InMemorySpanExporter::default();
        let traces = opentelemetry_sdk::trace::SdkTracerProvider::builder()
            .with_resource(resource.clone())
            .with_simple_exporter(
                super::file::Exporter::create_file(
                    &directory.path().join("traces.jsonl"),
                    &resource,
                )
                .unwrap(),
            )
            .with_simple_exporter(span_exporter.clone())
            .build();
        let log_exporter = opentelemetry_sdk::logs::InMemoryLogExporter::default();
        let logs = opentelemetry_sdk::logs::SdkLoggerProvider::builder()
            .with_resource(resource.clone())
            .with_simple_exporter(
                super::file::Exporter::create_file(&directory.path().join("logs.jsonl"), &resource)
                    .unwrap(),
            )
            .with_simple_exporter(log_exporter.clone())
            .build();
        let metric_exporter = opentelemetry_sdk::metrics::InMemoryMetricExporter::default();
        let metrics = opentelemetry_sdk::metrics::SdkMeterProvider::builder()
            .with_resource(resource.clone())
            .with_periodic_exporter(
                super::file::Exporter::create_file(
                    &directory.path().join("metrics.jsonl"),
                    &resource,
                )
                .unwrap(),
            )
            .with_periodic_exporter(metric_exporter.clone())
            .build();
        opentelemetry::global::set_meter_provider(metrics.clone());
        opentelemetry::global::set_text_map_propagator(
            opentelemetry_sdk::propagation::TraceContextPropagator::new(),
        );
        let subscriber = tracing_subscriber::registry()
            .with(tracing_opentelemetry::layer().with_tracer(traces.tracer("test")))
            .with(opentelemetry_appender_tracing::layer::OpenTelemetryTracingBridge::new(&logs));
        let dispatch = tracing::Dispatch::new(subscriber);
        let router = axum::Router::new()
            .route(
                "/items/{id}",
                axum::routing::post(|| async {
                    let dispatch = tracing::dispatcher::get_default(Clone::clone);
                    tokio::spawn(
                        async {
                            let mut token = crate::rpc::Token::new(
                                "x-ku-potato-worker-token",
                                "must-not-export-this-secret",
                            )
                            .unwrap();
                            let request = token.call(tonic::Request::new(())).unwrap();
                            tracing::info!("RPC prepared");
                            request
                                .metadata()
                                .get("traceparent")
                                .unwrap()
                                .to_str()
                                .unwrap()
                                .to_owned()
                        }
                        .instrument(tracing::info_span!("operation.execute"))
                        .with_subscriber(dispatch),
                    )
                    .await
                    .unwrap()
                }),
            )
            .route(
                "/failure",
                axum::routing::get(|| async { axum::http::StatusCode::INTERNAL_SERVER_ERROR }),
            )
            .layer(axum::middleware::from_fn(super::observe_http));
        let response = router
            .clone()
            .oneshot(
                axum::http::Request::builder()
                    .method("POST")
                    .uri("/items/private-id?token=must-not-export-this-secret")
                    .header(
                        "traceparent",
                        "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01",
                    )
                    .header("authorization", "must-not-export-this-secret")
                    .body(axum::body::Body::from("must-not-export-this-secret"))
                    .unwrap(),
            )
            .with_subscriber(dispatch.clone())
            .await
            .unwrap();
        assert_eq!(response.status(), axum::http::StatusCode::OK);
        let metadata = String::from_utf8(
            axum::body::to_bytes(response.into_body(), 1024)
                .await
                .unwrap()
                .to_vec(),
        )
        .unwrap();
        let response = router
            .oneshot(
                axum::http::Request::builder()
                    .uri("/failure")
                    .header("traceparent", "invalid")
                    .body(axum::body::Body::empty())
                    .unwrap(),
            )
            .with_subscriber(dispatch.clone())
            .await
            .unwrap();
        assert_eq!(
            response.status(),
            axum::http::StatusCode::INTERNAL_SERVER_ERROR
        );
        drop(dispatch);
        traces.force_flush().unwrap();
        logs.force_flush().unwrap();
        metrics.force_flush().unwrap();
        let spans = span_exporter.get_finished_spans().unwrap();
        let http = spans
            .iter()
            .find(|span| span.name == "POST /items/{id}")
            .unwrap();
        assert_eq!(http.span_kind, opentelemetry::trace::SpanKind::Server);
        assert_eq!(
            http.span_context.trace_id().to_string(),
            "0123456789abcdef0123456789abcdef"
        );
        assert_eq!(http.parent_span_id.to_string(), "0123456789abcdef");
        let operation = spans
            .iter()
            .find(|span| span.name == "operation.execute")
            .unwrap();
        assert_eq!(operation.parent_span_id, http.span_context.span_id());
        assert_eq!(
            metadata,
            format!(
                "00-0123456789abcdef0123456789abcdef-{}-01",
                operation.span_context.span_id()
            )
        );
        let failure = spans
            .iter()
            .find(|span| span.name == "GET /failure")
            .unwrap();
        assert_ne!(
            failure.span_context.trace_id(),
            http.span_context.trace_id()
        );
        assert!(matches!(
            failure.status,
            opentelemetry::trace::Status::Error { .. }
        ));
        let records = log_exporter.get_emitted_logs().unwrap();
        let record = records
            .iter()
            .find(|log| {
                log.record.body() == Some(&opentelemetry::logs::AnyValue::from("RPC prepared"))
            })
            .unwrap();
        let context = record.record.trace_context().unwrap();
        assert_eq!(context.trace_id, operation.span_context.trace_id());
        assert_eq!(context.span_id, operation.span_context.span_id());
        let measurements = metric_exporter.get_finished_metrics().unwrap();
        let metric = measurements
            .iter()
            .flat_map(|resource| resource.scope_metrics())
            .flat_map(|scope| scope.metrics())
            .find(|metric| metric.name() == "http.server.request.duration")
            .unwrap();
        assert_eq!(metric.unit(), "s");
        let opentelemetry_sdk::metrics::data::AggregatedMetrics::F64(
            opentelemetry_sdk::metrics::data::MetricData::Histogram(histogram),
        ) = metric.data()
        else {
            panic!("expected a duration histogram");
        };
        let point = histogram
            .data_points()
            .find(|point| {
                point.attributes().any(|attribute| {
                    attribute == &opentelemetry::KeyValue::new("http.route", "/items/{id}")
                })
            })
            .unwrap();
        assert_eq!(point.count(), 1);
        assert!(point.sum() > 0.0);
        let output = format!("{spans:?}{records:?}{measurements:?}");
        assert!(!output.contains("must-not-export-this-secret"));
        assert!(!output.contains("private-id"));
        struct Recording {
            file_name: &'static str,
            resource_key: &'static str,
        }
        for recording in [
            Recording {
                file_name: "traces.jsonl",
                resource_key: "resourceSpans",
            },
            Recording {
                file_name: "metrics.jsonl",
                resource_key: "resourceMetrics",
            },
            Recording {
                file_name: "logs.jsonl",
                resource_key: "resourceLogs",
            },
        ] {
            let path = directory.path().join(recording.file_name);
            let data = std::fs::read_to_string(&path).unwrap();
            let records = data
                .lines()
                .map(|line| serde_json::from_str::<serde_json::Value>(line).unwrap())
                .collect::<Vec<_>>();
            assert!(!records.is_empty());
            for record in records {
                let resources = record[recording.resource_key].as_array().unwrap();
                assert!(!resources.is_empty());
                for resource in resources {
                    let attributes = resource["resource"]["attributes"].as_array().unwrap();
                    assert!(attributes.iter().any(|attribute| {
                        attribute["key"] == "service.name"
                            && attribute["value"]["stringValue"] == "app-server"
                    }));
                    assert!(attributes.iter().any(|attribute| {
                        attribute["key"] == "service.instance.id"
                            && attribute["value"]["stringValue"] == instance_id.to_string()
                    }));
                }
            }
            assert!(!data.contains("must-not-export-this-secret"));
            assert!(!data.contains("private-id"));
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt as _;
                assert_eq!(
                    std::fs::metadata(&path).unwrap().permissions().mode() & 0o077,
                    0
                );
            }
        }
        let trace_data = std::fs::read_to_string(directory.path().join("traces.jsonl")).unwrap();
        assert!(trace_data.contains("0123456789abcdef0123456789abcdef"));
        assert_eq!(
            super::file::Exporter::create_file(&directory.path().join("traces.jsonl"), &resource)
                .unwrap_err()
                .kind(),
            std::io::ErrorKind::AlreadyExists
        );
        assert_eq!(
            std::fs::read_to_string(directory.path().join("traces.jsonl")).unwrap(),
            trace_data
        );
    }
}
