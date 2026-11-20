use std::io::{Seek as _, Write as _};

#[derive(Debug)]
pub(super) struct Exporter {
    file: std::sync::Mutex<Option<std::fs::File>>,
    resource: opentelemetry_proto::transform::common::tonic::ResourceAttributesWithSchema,
}

impl Exporter {
    pub(super) fn create_file(
        path: &std::path::Path,
        resource: &opentelemetry_sdk::Resource,
    ) -> Result<Self, std::io::Error> {
        let mut options = std::fs::OpenOptions::new();
        options.create_new(true).write(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt as _;
            options.mode(0o600);
        }
        Ok(Self {
            file: std::sync::Mutex::new(Some(options.open(path)?)),
            resource: resource.into(),
        })
    }

    fn write_record(
        &self,
        record: &impl serde::Serialize,
    ) -> opentelemetry_sdk::error::OTelSdkResult {
        let mut data = serde_json::to_vec(record).map_err(|error| {
            opentelemetry_sdk::error::OTelSdkError::InternalFailure(error.to_string())
        })?;
        data.push(b'\n');
        let mut guard = self.file.lock().map_err(|error| {
            opentelemetry_sdk::error::OTelSdkError::InternalFailure(error.to_string())
        })?;
        let file = guard.as_mut().ok_or_else(|| {
            opentelemetry_sdk::error::OTelSdkError::InternalFailure(
                "telemetry file disabled after failed recovery".to_owned(),
            )
        })?;
        let position = file.stream_position().map_err(|error| {
            opentelemetry_sdk::error::OTelSdkError::InternalFailure(error.to_string())
        })?;
        if let Err(error) = file.write_all(&data) {
            if let Err(recovery) = file
                .set_len(position)
                .and_then(|()| file.seek(std::io::SeekFrom::Start(position)))
            {
                *guard = None;
                return Err(opentelemetry_sdk::error::OTelSdkError::InternalFailure(
                    format!("{error}; failed to restore record boundary: {recovery}"),
                ));
            }
            return Err(opentelemetry_sdk::error::OTelSdkError::InternalFailure(
                error.to_string(),
            ));
        }
        Ok(())
    }
}

impl opentelemetry_sdk::trace::SpanExporter for Exporter {
    async fn export(
        &self,
        batch: Vec<opentelemetry_sdk::trace::SpanData>,
    ) -> opentelemetry_sdk::error::OTelSdkResult {
        self.write_record(
            &opentelemetry_proto::tonic::collector::trace::v1::ExportTraceServiceRequest {
                resource_spans:
                    opentelemetry_proto::transform::trace::tonic::group_spans_by_resource_and_scope(
                        batch,
                        &self.resource,
                    ),
            },
        )
    }
}

impl opentelemetry_sdk::logs::LogExporter for Exporter {
    async fn export(
        &self,
        batch: opentelemetry_sdk::logs::LogBatch<'_>,
    ) -> opentelemetry_sdk::error::OTelSdkResult {
        self.write_record(
            &opentelemetry_proto::tonic::collector::logs::v1::ExportLogsServiceRequest {
                resource_logs:
                    opentelemetry_proto::transform::logs::tonic::group_logs_by_resource_and_scope(
                        &batch,
                        &self.resource,
                    ),
            },
        )
    }
}

impl opentelemetry_sdk::metrics::exporter::PushMetricExporter for Exporter {
    async fn export(
        &self,
        metrics: &opentelemetry_sdk::metrics::data::ResourceMetrics,
    ) -> opentelemetry_sdk::error::OTelSdkResult {
        self.write_record(
            &opentelemetry_proto::tonic::collector::metrics::v1::ExportMetricsServiceRequest::from(
                metrics,
            ),
        )
    }

    fn force_flush(&self) -> opentelemetry_sdk::error::OTelSdkResult {
        Ok(())
    }

    fn shutdown_with_timeout(
        &self,
        _timeout: std::time::Duration,
    ) -> opentelemetry_sdk::error::OTelSdkResult {
        Ok(())
    }

    fn temporality(&self) -> opentelemetry_sdk::metrics::Temporality {
        opentelemetry_sdk::metrics::Temporality::Cumulative
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn failed_recovery_disables_further_writes() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("logs.jsonl");
        std::fs::write(&path, b"{}\n").unwrap();
        let exporter = super::Exporter {
            file: std::sync::Mutex::new(Some(std::fs::File::open(&path).unwrap())),
            resource: (&opentelemetry_sdk::Resource::builder_empty().build()).into(),
        };
        assert!(exporter.write_record(&"failed").is_err());
        assert!(exporter.file.lock().unwrap().is_none());
        assert!(exporter.write_record(&"must not append").is_err());
        assert_eq!(std::fs::read(&path).unwrap(), b"{}\n");
    }
}
