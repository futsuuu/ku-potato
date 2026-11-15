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
    if !(-62_135_596_800..=253_402_300_799).contains(&value.seconds)
        || !(0..1_000_000_000).contains(&value.nanos)
    {
        return Err(invalid());
    }
    chrono::DateTime::from_timestamp(value.seconds, value.nanos as u32).ok_or_else(invalid)
}

fn date(
    value: Option<super::protocol::browser_worker::CalendarDate>,
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

fn course(
    value: super::protocol::browser_worker::Course,
    year: crate::model::AcademicYear,
) -> Result<crate::model::Course, super::Error> {
    let access = match required(value.access, "course access")? {
        super::protocol::browser_worker::course::Access::Available(id) => {
            crate::model::Access::Available {
                id: id.value.try_into()?,
            }
        }
        super::protocol::browser_worker::course::Access::Unavailable(()) => {
            crate::model::Access::Unavailable
        }
    };
    let schedule = match required(value.schedule, "course schedule")? {
        super::protocol::browser_worker::course::Schedule::Scheduled(value) => {
            crate::model::Schedule::Scheduled {
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
            }
        }
        super::protocol::browser_worker::course::Schedule::Other(()) => {
            crate::model::Schedule::Other
        }
        super::protocol::browser_worker::course::Schedule::UnknownSchedule(()) => {
            crate::model::Schedule::Unknown
        }
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
    value: super::protocol::browser_worker::CourseListing,
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

fn material(
    value: super::protocol::browser_worker::Material,
) -> Result<crate::model::Material, super::Error> {
    let deadline = match required(
        required(value.publication_deadline, "publication deadline")?.value,
        "deadline value",
    )? {
        super::protocol::browser_worker::publication_deadline::Value::At(at) => {
            crate::model::Deadline::At { at: timestamp(at)? }
        }
        super::protocol::browser_worker::publication_deadline::Value::Unlisted(()) => {
            crate::model::Deadline::Unlisted
        }
        super::protocol::browser_worker::publication_deadline::Value::Closed(()) => {
            crate::model::Deadline::Closed
        }
        super::protocol::browser_worker::publication_deadline::Value::Unknown(()) => {
            crate::model::Deadline::Unknown
        }
    };
    let kind = match required(value.kind, "material kind")? {
        super::protocol::browser_worker::material::Kind::Document(value) => {
            crate::model::MaterialKind::Material {
                status: enumeration(
                    value.status,
                    "DOCUMENT_STATUS_",
                    |value: super::protocol::browser_worker::DocumentStatus| value.as_str_name(),
                )?,
                resource_availability: enumeration(
                    value.resource_availability,
                    "LINK_AVAILABILITY_",
                    |value: super::protocol::browser_worker::LinkAvailability| value.as_str_name(),
                )?,
            }
        }
        super::protocol::browser_worker::material::Kind::Report(value) => {
            crate::model::MaterialKind::Report {
                status: enumeration(
                    value.status,
                    "REPORT_MATERIAL_STATUS_",
                    |value: super::protocol::browser_worker::ReportMaterialStatus| {
                        value.as_str_name()
                    },
                )?,
            }
        }
        super::protocol::browser_worker::material::Kind::Test(value) => {
            crate::model::MaterialKind::Test {
                status: enumeration(
                    value.status,
                    "TEST_STATUS_",
                    |value: super::protocol::browser_worker::TestStatus| value.as_str_name(),
                )?,
            }
        }
        super::protocol::browser_worker::material::Kind::Questionnaire(value) => {
            crate::model::MaterialKind::Questionnaire {
                status: enumeration(
                    value.status,
                    "QUESTIONNAIRE_STATUS_",
                    |value: super::protocol::browser_worker::QuestionnaireStatus| {
                        value.as_str_name()
                    },
                )?,
            }
        }
        super::protocol::browser_worker::material::Kind::ELearning(value) => {
            crate::model::MaterialKind::ELearning {
                status: enumeration(
                    value.status,
                    "E_LEARNING_STATUS_",
                    |value: super::protocol::browser_worker::ELearningStatus| value.as_str_name(),
                )?,
            }
        }
        super::protocol::browser_worker::material::Kind::Board(value) => {
            crate::model::MaterialKind::Board {
                status: enumeration(
                    value.status,
                    "BOARD_STATUS_",
                    |value: super::protocol::browser_worker::BoardStatus| value.as_str_name(),
                )?,
            }
        }
        super::protocol::browser_worker::material::Kind::Feedback(value) => {
            crate::model::MaterialKind::Feedback {
                status: enumeration(
                    value.status,
                    "FEEDBACK_STATUS_",
                    |value: super::protocol::browser_worker::FeedbackStatus| value.as_str_name(),
                )?,
            }
        }
        super::protocol::browser_worker::material::Kind::Unknown(()) => {
            crate::model::MaterialKind::Unknown {
                status: crate::model::Unknown::Unknown,
            }
        }
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
    value: super::protocol::browser_worker::CourseMaterials,
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

fn resource(
    value: super::protocol::browser_worker::Resource,
) -> Result<crate::model::Resource, super::Error> {
    let content = match required(value.content, "resource content")? {
        super::protocol::browser_worker::resource::Content::File(file) => {
            crate::model::ResourceContent::File {
                url: if file.url.is_empty() {
                    None
                } else {
                    Some(file.url.try_into()?)
                },
            }
        }
        super::protocol::browser_worker::resource::Content::ExternalUrl(url) => {
            crate::model::ResourceContent::External {
                url: url.try_into()?,
            }
        }
        super::protocol::browser_worker::resource::Content::Unknown(value) => {
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
            |value: super::protocol::browser_worker::ResourceStatus| value.as_str_name(),
        )?,
        content,
        registered_on: date(value.registered_on)?,
        first_viewed_on: date(value.first_viewed_on)?,
        description: value.description,
        saved_file: None,
        archived: false,
    })
}

fn report(
    value: super::protocol::browser_worker::Report,
) -> Result<crate::model::Report, super::Error> {
    let submission = match required(
        required(value.submission_period, "submission period")?.kind,
        "submission period kind",
    )? {
        super::protocol::browser_worker::submission_period::Kind::At(value) => {
            crate::model::SubmissionPeriod::At(crate::model::SubmissionWindow::new(
                value.starts_at.map(timestamp).transpose()?,
                value.due_at.map(timestamp).transpose()?,
            )?)
        }
        super::protocol::browser_worker::submission_period::Kind::Unlisted(()) => {
            crate::model::SubmissionPeriod::Unlisted
        }
        super::protocol::browser_worker::submission_period::Kind::Unknown(()) => {
            crate::model::SubmissionPeriod::Unknown
        }
    };
    let correction = match required(
        required(value.correction_policy, "correction policy")?.kind,
        "correction kind",
    )? {
        super::protocol::browser_worker::correction_policy::Kind::Unknown(()) => {
            crate::model::Correction::Unknown
        }
        super::protocol::browser_worker::correction_policy::Kind::NotAllowed(()) => {
            crate::model::Correction::NotAllowed
        }
        super::protocol::browser_worker::correction_policy::Kind::Unlimited(()) => {
            crate::model::Correction::Unlimited
        }
        super::protocol::browser_worker::correction_policy::Kind::Limited(limit) => {
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
            |value: super::protocol::browser_worker::ReportStatus| value.as_str_name(),
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

pub fn snapshot(
    value: super::protocol::browser_worker::Snapshot,
) -> Result<crate::model::Snapshot, super::Error> {
    let courses = if value.academic_year == 0 && value.courses.is_empty() {
        None
    } else {
        Some(course_listing(
            super::protocol::browser_worker::CourseListing {
                academic_year: value.academic_year,
                courses: value.courses,
            },
        )?)
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

pub fn failure(value: super::protocol::browser_worker::Failure) -> super::Error {
    match super::protocol::browser_worker::FailureReason::try_from(value.reason) {
        Ok(super::protocol::browser_worker::FailureReason::AuthenticationRequired) => {
            return super::Error::AuthenticationRequired(super::Provider::Lms);
        }
        Ok(super::protocol::browser_worker::FailureReason::AuthenticationStorage) => {
            return super::Error::AuthenticationStorage {
                message: value.message,
            };
        }
        Ok(super::protocol::browser_worker::FailureReason::BrowserStart) => {
            return super::Error::BrowserStart {
                message: value.message,
            };
        }
        Ok(super::protocol::browser_worker::FailureReason::CourseNotFound) => {
            if let Some(super::protocol::browser_worker::failure::Target::CourseId(id)) =
                value.target
            {
                return crate::model::CourseId::try_from(id.value)
                    .map(|id| super::Error::CourseNotFound { id })
                    .unwrap_or_else(super::Error::from);
            }
        }
        Ok(super::protocol::browser_worker::FailureReason::MaterialNotFound) => {
            if let Some(super::protocol::browser_worker::failure::Target::MaterialId(id)) =
                value.target
            {
                return crate::model::MaterialId::try_from(id.value)
                    .map(|id| super::Error::MaterialNotFound { id })
                    .unwrap_or_else(super::Error::from);
            }
        }
        Ok(super::protocol::browser_worker::FailureReason::ResourceNotFound) => {
            if let Some(super::protocol::browser_worker::failure::Target::ResourceId(id)) =
                value.target
            {
                return crate::model::ResourceId::try_from(id.value)
                    .map(|id| super::Error::ResourceNotFound { id })
                    .unwrap_or_else(super::Error::from);
            }
        }
        Ok(super::protocol::browser_worker::FailureReason::UnsupportedResource) => {
            if let Some(super::protocol::browser_worker::failure::Target::ResourceId(id)) =
                value.target
            {
                return crate::model::ResourceId::try_from(id.value)
                    .map(|id| super::Error::UnsupportedResource { id })
                    .unwrap_or_else(super::Error::from);
            }
        }
        Ok(super::protocol::browser_worker::FailureReason::Source) => {
            return super::Error::Source {
                message: value.message,
            };
        }
        Ok(super::protocol::browser_worker::FailureReason::Forbidden) => {
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
                super::protocol::browser_worker::failure::Target::CourseId(id) => {
                    serde_json::json!({ "courseId": id.value })
                }
                super::protocol::browser_worker::failure::Target::MaterialId(id) => {
                    serde_json::json!({ "materialId": id.value })
                }
                super::protocol::browser_worker::failure::Target::ResourceId(id) => {
                    serde_json::json!({ "resourceId": id.value })
                }
            }),
        }),
    )
}

pub fn cookie(
    value: super::protocol::user_browser::Cookie,
) -> Result<super::protocol::browser_worker::Cookie, super::Error> {
    super::protocol::user_browser::CookieSameSite::try_from(value.same_site).map_err(|_| {
        super::Error::invalid_response(
            "cookie same site",
            serde_json::json!({ "value": value.same_site }),
        )
    })?;
    super::protocol::user_browser::CookiePriority::try_from(value.priority).map_err(|_| {
        super::Error::invalid_response(
            "cookie priority",
            serde_json::json!({ "value": value.priority }),
        )
    })?;
    super::protocol::user_browser::CookieSourceScheme::try_from(value.source_scheme).map_err(
        |_| {
            super::Error::invalid_response(
                "cookie source scheme",
                serde_json::json!({ "value": value.source_scheme }),
            )
        },
    )?;
    if let Some(expires) = &value.expires {
        timestamp(*expires)?;
    }
    Ok(super::protocol::browser_worker::Cookie {
        name: value.name,
        value: value.value,
        domain: value.domain,
        path: value.path,
        secure: value.secure,
        http_only: value.http_only,
        same_site: value.same_site,
        expires: value.expires,
        priority: value.priority,
        source_scheme: value.source_scheme,
        source_port: value.source_port,
        partition_key: value.partition_key.map(|key| {
            super::protocol::browser_worker::PartitionKey {
                top_level_site: key.top_level_site,
                has_cross_site_ancestor: key.has_cross_site_ancestor,
            }
        }),
    })
}

#[cfg(test)]
mod tests {
    #[test]
    fn enum_conversion_errors_preserve_the_wire_value_and_source() {
        let value = i32::from(super::super::protocol::browser_worker::ResourceStatus::Viewed);
        let error = super::enumeration::<
            super::super::protocol::browser_worker::ResourceStatus,
            crate::model::ReportStatus,
        >(value, "RESOURCE_STATUS_", |value| value.as_str_name())
        .unwrap_err();
        assert!(matches!(
            &error,
            super::super::Error::InvalidResponse { field, details, .. }
                if *field == std::any::type_name::<super::super::protocol::browser_worker::ResourceStatus>()
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
}
