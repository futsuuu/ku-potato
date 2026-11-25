fn required<T>(value: Option<T>, field: &'static str) -> Result<T, super::Error> {
    value.ok_or_else(|| super::Error::invalid_response(field, serde_json::Value::Null))
}

pub fn timestamp(
    value: prost_types::Timestamp,
) -> Result<chrono::DateTime<chrono::Utc>, super::Error> {
    let invalid = || {
        super::Error::invalid_response(
            "timestamp",
            serde_json::json!({ "seconds": value.seconds, "nanos": value.nanos }),
        )
    };
    crate::rpc::decode_timestamp(value).ok_or_else(invalid)
}

#[test]
fn invalid_timestamps_preserve_the_invalid_data() {
    for timestamp in [
        prost_types::Timestamp {
            seconds: 0,
            nanos: -1,
        },
        prost_types::Timestamp {
            seconds: 253402300800,
            nanos: 0,
        },
    ] {
        assert!(matches!(
            self::timestamp(timestamp),
            Err(super::Error::InvalidResponse { field: "timestamp", details, .. })
                if details == serde_json::json!({ "seconds": timestamp.seconds, "nanos": timestamp.nanos })
        ));
    }
}

fn date(
    value: Option<super::protocol::CalendarDate>,
) -> Result<Option<chrono::NaiveDate>, super::Error> {
    value
        .map(|value| {
            let invalid = || {
                super::Error::invalid_response(
                    "calendar date",
                    serde_json::json!({
                        "year": value.year,
                        "month": value.month,
                        "day": value.day,
                    }),
                )
            };
            if !(1..=9999).contains(&value.year) {
                return Err(invalid());
            }
            chrono::NaiveDate::from_ymd_opt(value.year, value.month as u32, value.day as u32)
                .ok_or_else(invalid)
        })
        .transpose()
}

fn enumeration<E, T>(
    value: i32,
    prefix: &'static str,
    name: impl FnOnce(E) -> &'static str,
) -> Result<T, super::Error>
where
    E: TryFrom<i32>,
    T: serde::de::DeserializeOwned,
{
    let invalid = || {
        super::Error::invalid_response(
            std::any::type_name::<E>(),
            serde_json::json!({ "value": value }),
        )
    };
    if value == 0 {
        return Err(invalid());
    }
    let variant = E::try_from(value).map_err(|_| invalid())?;
    let name = name(variant);
    let text = name
        .strip_prefix(prefix)
        .ok_or_else(|| {
            super::Error::invalid_response(
                std::any::type_name::<E>(),
                serde_json::json!({ "name": name, "prefix": prefix }),
            )
        })?
        .to_lowercase()
        .replace('_', "-");
    serde_json::from_value(serde_json::Value::String(text)).map_err(|source| {
        super::Error::InvalidResponse {
            field: std::any::type_name::<E>(),
            details: serde_json::json!({ "value": value }),
            source: Some(Box::new(source)),
        }
    })
}

#[test]
fn enum_conversion_errors_preserve_the_wire_value_and_source() {
    let value = i32::from(super::protocol::ResourceStatus::Viewed);
    let error = enumeration::<super::protocol::ResourceStatus, crate::model::ReportStatus>(
        value,
        "RESOURCE_STATUS_",
        |value| value.as_str_name(),
    )
    .unwrap_err();
    assert!(matches!(
        &error,
        super::Error::InvalidResponse { field, details, .. }
            if *field == std::any::type_name::<super::protocol::ResourceStatus>()
            && details["value"] == value
    ));
    assert!(
        std::error::Error::source(&error)
            .unwrap()
            .downcast_ref::<serde_json::Error>()
            .unwrap()
            .is_data()
    );
}

fn course(
    value: super::protocol::Course,
    year: crate::model::AcademicYear,
) -> Result<crate::model::Course, super::Error> {
    let access = match required(value.access, "course access")? {
        super::protocol::course::Access::Available(id) => crate::model::Access::Available {
            id: id.value.try_into()?,
        },
        super::protocol::course::Access::Unavailable(()) => crate::model::Access::Unavailable,
    };
    let schedule = match required(value.schedule, "course schedule")? {
        super::protocol::course::Schedule::Scheduled(value) => crate::model::Schedule::Scheduled {
            weekday: u8::try_from(value.weekday)
                .ok()
                .and_then(|weekday| weekday.try_into().ok())
                .ok_or_else(|| {
                    super::Error::invalid_response(
                        "weekday",
                        serde_json::json!({ "value": value.weekday }),
                    )
                })?,
            period: u32::try_from(value.period)
                .ok()
                .and_then(std::num::NonZeroU32::new)
                .ok_or_else(|| {
                    super::Error::invalid_response(
                        "period",
                        serde_json::json!({ "value": value.period }),
                    )
                })?,
        },
        super::protocol::course::Schedule::Other(()) => crate::model::Schedule::Other,
        super::protocol::course::Schedule::UnknownSchedule(()) => crate::model::Schedule::Unknown,
    };
    Ok(crate::model::Course {
        name: value.name,
        academic_year: year,
        access,
        schedule,
        archived: false,
    })
}

pub fn course_listing(
    value: super::protocol::CourseListing,
) -> Result<crate::model::CourseListing, super::Error> {
    let year = value.academic_year.try_into().map_err(|_| {
        super::Error::invalid_response(
            "academic year",
            serde_json::json!({ "value": value.academic_year }),
        )
    })?;
    Ok(crate::model::CourseListing {
        academic_year: year,
        entries: value
            .courses
            .into_iter()
            .map(|value| course(value, year))
            .collect::<Result<_, _>>()?,
    })
}

fn material(value: super::protocol::Material) -> Result<crate::model::Material, super::Error> {
    let deadline = match required(
        required(value.publication_deadline, "publication deadline")?.value,
        "deadline value",
    )? {
        super::protocol::publication_deadline::Value::At(at) => {
            crate::model::Deadline::At { at: timestamp(at)? }
        }
        super::protocol::publication_deadline::Value::Unlisted(()) => {
            crate::model::Deadline::Unlisted
        }
        super::protocol::publication_deadline::Value::Closed(()) => crate::model::Deadline::Closed,
        super::protocol::publication_deadline::Value::Unknown(()) => {
            crate::model::Deadline::Unknown
        }
    };
    let kind = match required(value.kind, "material kind")? {
        super::protocol::material::Kind::Document(value) => crate::model::MaterialKind::Material {
            status: enumeration(
                value.status,
                "DOCUMENT_STATUS_",
                |value: super::protocol::DocumentStatus| value.as_str_name(),
            )?,
            resource_availability: enumeration(
                value.resource_availability,
                "LINK_AVAILABILITY_",
                |value: super::protocol::LinkAvailability| value.as_str_name(),
            )?,
        },
        super::protocol::material::Kind::Report(value) => crate::model::MaterialKind::Report {
            status: enumeration(
                value.status,
                "REPORT_MATERIAL_STATUS_",
                |value: super::protocol::ReportMaterialStatus| value.as_str_name(),
            )?,
        },
        super::protocol::material::Kind::Test(value) => crate::model::MaterialKind::Test {
            status: enumeration(
                value.status,
                "TEST_STATUS_",
                |value: super::protocol::TestStatus| value.as_str_name(),
            )?,
        },
        super::protocol::material::Kind::Questionnaire(value) => {
            crate::model::MaterialKind::Questionnaire {
                status: enumeration(
                    value.status,
                    "QUESTIONNAIRE_STATUS_",
                    |value: super::protocol::QuestionnaireStatus| value.as_str_name(),
                )?,
            }
        }
        super::protocol::material::Kind::ELearning(value) => {
            crate::model::MaterialKind::ELearning {
                status: enumeration(
                    value.status,
                    "E_LEARNING_STATUS_",
                    |value: super::protocol::ELearningStatus| value.as_str_name(),
                )?,
            }
        }
        super::protocol::material::Kind::Board(value) => crate::model::MaterialKind::Board {
            status: enumeration(
                value.status,
                "BOARD_STATUS_",
                |value: super::protocol::BoardStatus| value.as_str_name(),
            )?,
        },
        super::protocol::material::Kind::Feedback(value) => crate::model::MaterialKind::Feedback {
            status: enumeration(
                value.status,
                "FEEDBACK_STATUS_",
                |value: super::protocol::FeedbackStatus| value.as_str_name(),
            )?,
        },
        super::protocol::material::Kind::Unknown(()) => crate::model::MaterialKind::Unknown {
            status: crate::model::Unknown::Unknown,
        },
    };
    Ok(crate::model::Material {
        id: required(value.id, "material ID")?.value.try_into()?,
        name: value.name,
        kind,
        deadline,
        material_link_available: value.material_link_available,
        retrieved_at: None,
        archived: false,
    })
}

fn materials(
    value: super::protocol::CourseMaterials,
) -> Result<crate::model::CourseMaterials, super::Error> {
    let mut folders = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for folder in value.folders {
        let materials = folder
            .materials
            .into_iter()
            .map(material)
            .collect::<Result<Vec<_>, _>>()?;
        for material in &materials {
            if !seen.insert(material.id.clone()) {
                return Err(super::Error::invalid_response(
                    "material ID",
                    serde_json::json!({ "duplicate": material.id }),
                ));
            }
        }
        folders.push(crate::model::Folder {
            name: folder.name,
            class_date: date(folder.class_date)?,
            description_html: folder.description_html,
            materials,
        });
    }
    Ok(crate::model::CourseMaterials {
        course_id: required(value.course_id, "course ID")?.value.try_into()?,
        folders,
    })
}

fn resource(value: super::protocol::Resource) -> Result<crate::model::Resource, super::Error> {
    let content = match required(value.content, "resource content")? {
        super::protocol::resource::Content::File(file) => crate::model::ResourceContent::File {
            url: if file.url.is_empty() {
                None
            } else {
                Some(file.url.try_into()?)
            },
        },
        super::protocol::resource::Content::ExternalUrl(url) => {
            crate::model::ResourceContent::External {
                url: url.try_into()?,
            }
        }
        super::protocol::resource::Content::Unknown(value) => {
            crate::model::ResourceContent::Unknown {
                url: if value.url.is_empty() {
                    None
                } else {
                    Some(value.url.try_into()?)
                },
            }
        }
    };
    Ok(crate::model::Resource {
        id: required(value.id, "resource ID")?.value.try_into()?,
        name: value.name,
        status: enumeration(
            value.status,
            "RESOURCE_STATUS_",
            |value: super::protocol::ResourceStatus| value.as_str_name(),
        )?,
        content,
        registered_on: date(value.registered_on)?,
        first_viewed_on: date(value.first_viewed_on)?,
        description: value.description,
        saved_file: None,
        google_drive_file: None,
        archived: false,
    })
}

fn report(value: super::protocol::Report) -> Result<crate::model::Report, super::Error> {
    let submission = match required(
        required(value.submission_period, "submission period")?.kind,
        "submission period kind",
    )? {
        super::protocol::submission_period::Kind::At(value) => {
            crate::model::SubmissionPeriod::At(crate::model::SubmissionWindow::new(
                value.starts_at.map(timestamp).transpose()?,
                value.due_at.map(timestamp).transpose()?,
            )?)
        }
        super::protocol::submission_period::Kind::Unlisted(()) => {
            crate::model::SubmissionPeriod::Unlisted
        }
        super::protocol::submission_period::Kind::Unknown(()) => {
            crate::model::SubmissionPeriod::Unknown
        }
    };
    let correction = match required(
        required(value.correction_policy, "correction policy")?.kind,
        "correction kind",
    )? {
        super::protocol::correction_policy::Kind::Unknown(()) => crate::model::Correction::Unknown,
        super::protocol::correction_policy::Kind::NotAllowed(()) => {
            crate::model::Correction::NotAllowed
        }
        super::protocol::correction_policy::Kind::Unlimited(()) => {
            crate::model::Correction::Unlimited
        }
        super::protocol::correction_policy::Kind::Limited(limit) => {
            crate::model::Correction::Limited {
                limit: limit.try_into().map_err(|_| {
                    super::Error::invalid_response(
                        "correction limit",
                        serde_json::json!({ "value": limit }),
                    )
                })?,
            }
        }
    };
    Ok(crate::model::Report {
        prompt_html: value.prompt_html,
        status: enumeration(
            value.status,
            "REPORT_STATUS_",
            |value: super::protocol::ReportStatus| value.as_str_name(),
        )?,
        submission,
        correction,
        text_answer_allowed: value.text_answer_allowed,
        file_answer_allowed: value.file_answer_allowed,
        max_total_file_bytes: value
            .max_total_file_bytes
            .map(|size| {
                size.try_into().map_err(|_| {
                    super::Error::invalid_response(
                        "maximum file size",
                        serde_json::json!({ "value": size }),
                    )
                })
            })
            .transpose()?,
        retrieved_at: None,
    })
}

pub fn snapshot(value: super::protocol::Snapshot) -> Result<crate::model::Snapshot, super::Error> {
    let courses = if value.academic_year == 0 && value.courses.is_empty() {
        None
    } else {
        Some(course_listing(super::protocol::CourseListing {
            academic_year: value.academic_year,
            courses: value.courses,
        })?)
    };
    let contents = match value.material_id {
        Some(id) => {
            let resources = value
                .resource_list
                .map(|list| {
                    let resources = list
                        .resources
                        .into_iter()
                        .map(resource)
                        .collect::<Result<Vec<_>, _>>()?;
                    let mut seen = std::collections::HashSet::new();
                    for resource in &resources {
                        if !seen.insert(&resource.id) {
                            return Err(super::Error::invalid_response(
                                "resource ID",
                                serde_json::json!({ "duplicate": resource.id }),
                            ));
                        }
                    }
                    Ok(resources)
                })
                .transpose()?;
            Some(crate::model::MaterialContents {
                material_id: id.value.try_into()?,
                resources,
                report: value.report.map(report).transpose()?,
            })
        }
        None if value.resource_list.is_some() || value.report.is_some() => {
            return Err(super::Error::invalid_response(
                "contents material ID",
                serde_json::Value::Null,
            ));
        }
        None => None,
    };
    Ok(crate::model::Snapshot {
        courses,
        materials: value.course_materials.map(materials).transpose()?,
        contents,
    })
}

#[test]
fn duplicate_responses_preserve_the_conflicting_identifier() {
    let mut value = crate::rpc::tests::snapshot();
    let folder = &mut value.course_materials.as_mut().unwrap().folders[0];
    folder.materials.push(folder.materials[0].clone());
    assert!(matches!(
        snapshot(value),
        Err(super::Error::InvalidResponse { field: "material ID", details, .. })
            if details == serde_json::json!({ "duplicate": "MAT1" })
    ));
    let mut value = crate::rpc::tests::snapshot();
    let resources = &mut value.resource_list.as_mut().unwrap().resources;
    resources.push(resources[0].clone());
    assert!(matches!(
        snapshot(value),
        Err(super::Error::InvalidResponse { field: "resource ID", details, .. })
            if details == serde_json::json!({ "duplicate": "SRS1" })
    ));
}

#[test]
fn malformed_wire_values_preserve_the_invalid_data() {
    let mut value = crate::rpc::tests::snapshot();
    value.academic_year = 10000;
    assert!(matches!(
        snapshot(value),
        Err(super::Error::InvalidResponse { field: "academic year", details, .. })
            if details == serde_json::json!({ "value": 10000 })
    ));
    let mut value = crate::rpc::tests::snapshot();
    value.resource_list.as_mut().unwrap().resources[0].status = 999;
    assert!(matches!(
        snapshot(value),
        Err(super::Error::InvalidResponse { field, details, .. })
            if field == std::any::type_name::<super::protocol::ResourceStatus>()
            && details == serde_json::json!({ "value": 999 })
    ));
    let mut value = crate::rpc::tests::snapshot();
    value.resource_list.as_mut().unwrap().resources[0].registered_on =
        Some(super::protocol::CalendarDate {
            year: 2026,
            month: 2,
            day: 30,
        });
    assert!(matches!(
        snapshot(value),
        Err(super::Error::InvalidResponse { field: "calendar date", details, .. })
            if details == serde_json::json!({ "year": 2026, "month": 2, "day": 30 })
    ));
    let mut value = crate::rpc::tests::snapshot();
    value.material_id = None;
    assert!(matches!(
        snapshot(value),
        Err(super::Error::InvalidResponse {
            field: "contents material ID",
            details: serde_json::Value::Null,
            ..
        })
    ));
}

pub fn failure(value: super::protocol::Failure) -> super::Error {
    match super::protocol::FailureReason::try_from(value.reason) {
        Ok(super::protocol::FailureReason::AuthenticationRequired) => {
            return super::Error::AuthenticationRequired;
        }
        Ok(super::protocol::FailureReason::AuthenticationStorage) => {
            return super::Error::AuthenticationStorage {
                message: value.message,
            };
        }
        Ok(super::protocol::FailureReason::BrowserStart) => {
            return super::Error::BrowserStart {
                message: value.message,
            };
        }
        Ok(super::protocol::FailureReason::CourseNotFound) => {
            if let Some(super::protocol::failure::Target::CourseId(id)) = value.target {
                return crate::model::CourseId::try_from(id.value)
                    .map(|id| super::Error::CourseNotFound { id })
                    .unwrap_or_else(super::Error::from);
            }
        }
        Ok(super::protocol::FailureReason::MaterialNotFound) => {
            if let Some(super::protocol::failure::Target::MaterialId(id)) = value.target {
                return crate::model::MaterialId::try_from(id.value)
                    .map(|id| super::Error::MaterialNotFound { id })
                    .unwrap_or_else(super::Error::from);
            }
        }
        Ok(super::protocol::FailureReason::ResourceNotFound) => {
            if let Some(super::protocol::failure::Target::ResourceId(id)) = value.target {
                return crate::model::ResourceId::try_from(id.value)
                    .map(|id| super::Error::ResourceNotFound { id })
                    .unwrap_or_else(super::Error::from);
            }
        }
        Ok(super::protocol::FailureReason::UnsupportedResource) => {
            if let Some(super::protocol::failure::Target::ResourceId(id)) = value.target {
                return crate::model::ResourceId::try_from(id.value)
                    .map(|id| super::Error::UnsupportedResource { id })
                    .unwrap_or_else(super::Error::from);
            }
        }
        Ok(super::protocol::FailureReason::Source) => {
            return super::Error::Source {
                message: value.message,
            };
        }
        Ok(super::protocol::FailureReason::Forbidden) => {
            return super::Error::Forbidden {
                message: value.message,
            };
        }
        _ => {}
    }
    super::Error::invalid_response(
        "failure",
        serde_json::json!({
            "service": "browser-worker",
            "reason": value.reason,
            "message": value.message,
            "target": value.target.map(|target| match target {
                super::protocol::failure::Target::CourseId(id) => {
                    serde_json::json!({ "courseId": id.value })
                }
                super::protocol::failure::Target::MaterialId(id) => {
                    serde_json::json!({ "materialId": id.value })
                }
                super::protocol::failure::Target::ResourceId(id) => {
                    serde_json::json!({ "resourceId": id.value })
                }
            }),
        }),
    )
}

#[test]
fn browser_worker_failures_reject_unknown_reasons() {
    for reason in [0, 999] {
        assert!(matches!(
            failure(super::protocol::Failure {
                reason,
                message: "Failure".into(),
                target: None,
            }),
            super::Error::InvalidResponse { field: "failure", details, .. }
                if details == serde_json::json!({
                    "service": "browser-worker",
                    "reason": reason,
                    "message": "Failure",
                    "target": null,
                })
        ));
    }
    assert!(matches!(
        failure(super::protocol::Failure {
            reason: super::protocol::FailureReason::AuthenticationRequired.into(),
            message: "Login required".into(),
            target: None,
        }),
        super::Error::AuthenticationRequired
    ));
}

#[test]
fn browser_worker_failures_preserve_public_reasons_and_messages() {
    for reason in [
        super::protocol::FailureReason::AuthenticationStorage,
        super::protocol::FailureReason::BrowserStart,
        super::protocol::FailureReason::Source,
        super::protocol::FailureReason::Forbidden,
    ] {
        let error = failure(super::protocol::Failure {
            reason: reason.into(),
            message: "Browser worker rejected the request".into(),
            target: None,
        });
        let public = crate::error::Public::from(&error);
        assert_eq!(
            serde_json::to_value(public.reason).unwrap(),
            reason
                .as_str_name()
                .strip_prefix("FAILURE_REASON_")
                .unwrap()
                .to_ascii_lowercase()
                .replace('_', "-"),
        );
        assert_eq!(public.message, "Browser worker rejected the request");
    }
}

#[test]
fn browser_worker_failures_require_valid_matching_targets() {
    for reason in [
        super::protocol::FailureReason::CourseNotFound,
        super::protocol::FailureReason::MaterialNotFound,
        super::protocol::FailureReason::ResourceNotFound,
        super::protocol::FailureReason::UnsupportedResource,
    ] {
        for target in [
            None,
            Some(super::protocol::failure::Target::CourseId(
                super::protocol::CourseId {
                    value: String::new(),
                },
            )),
            Some(super::protocol::failure::Target::MaterialId(
                super::protocol::MaterialId {
                    value: "invalid".into(),
                },
            )),
            Some(super::protocol::failure::Target::ResourceId(
                super::protocol::ResourceId {
                    value: "invalid".into(),
                },
            )),
        ] {
            let error = failure(super::protocol::Failure {
                reason: reason.into(),
                message: "Missing target".into(),
                target,
            });
            assert!(matches!(error, super::Error::InvalidResponse { .. }));
            assert_eq!(
                crate::error::Public::from(&error).reason,
                crate::error::Reason::Source
            );
        }
    }
    assert!(matches!(
        failure(super::protocol::Failure {
            reason: super::protocol::FailureReason::CourseNotFound.into(),
            message: "Wrong target".into(),
            target: Some(super::protocol::failure::Target::MaterialId(
                super::protocol::MaterialId { value: "MAT2".into() },
            )),
        }),
        super::Error::InvalidResponse { field: "failure", details, .. }
            if details["target"] == serde_json::json!({ "materialId": "MAT2" })
    ));
}
