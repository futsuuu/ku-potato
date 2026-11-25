pub fn enum_text(value: &impl serde::Serialize) -> Result<String, super::Error> {
    match serde_json::to_value(value)? {
        serde_json::Value::String(text) => Ok(text),
        _ => Err(super::Error::InvalidData("enum representation")),
    }
}

pub fn parse_enum<T: serde::de::DeserializeOwned>(text: String) -> Result<T, super::Error> {
    Ok(serde_json::from_value(serde_json::Value::String(text))?)
}

pub fn timestamp(millis: i64) -> Result<chrono::DateTime<chrono::Utc>, super::Error> {
    chrono::DateTime::from_timestamp_millis(millis)
        .ok_or(super::Error::InvalidData("stored timestamp"))
}

pub fn date(value: Option<String>) -> Result<Option<chrono::NaiveDate>, super::Error> {
    value
        .map(|value| {
            chrono::NaiveDate::parse_from_str(&value, "%Y-%m-%d")
                .map_err(|_| super::Error::InvalidData("stored date"))
        })
        .transpose()
}

impl super::entity::lms_courses::Model {
    pub fn into_course(
        self,
        year: i64,
        archived: bool,
    ) -> Result<crate::model::Course, super::Error> {
        let access = match (self.availability.as_str(), self.lms_course_id) {
            ("available", Some(id)) => crate::model::Access::Available { id: id.try_into()? },
            ("unavailable", None) => crate::model::Access::Unavailable,
            _ => return Err(super::Error::InvalidData("stored course access")),
        };
        let schedule = match (self.r#type.as_str(), self.weekday, self.period) {
            ("scheduled", Some(day), Some(period)) => crate::model::Schedule::Scheduled {
                weekday: u8::try_from(day)
                    .map_err(|_| super::Error::InvalidData("stored weekday"))?
                    .try_into()?,
                period: u32::try_from(period)
                    .ok()
                    .and_then(std::num::NonZeroU32::new)
                    .ok_or(super::Error::InvalidData("stored period"))?,
            },
            ("other", None, None) => crate::model::Schedule::Other,
            ("unknown", None, None) => crate::model::Schedule::Unknown,
            _ => return Err(super::Error::InvalidData("stored schedule")),
        };
        Ok(crate::model::Course {
            name: self.name,
            academic_year: i32::try_from(year)
                .map_err(|_| super::Error::InvalidData("stored year"))?
                .try_into()?,
            access,
            schedule,
            archived,
        })
    }
}

impl TryFrom<super::entity::lms_course_materials::Model> for crate::model::Material {
    type Error = super::Error;

    fn try_from(row: super::entity::lms_course_materials::Model) -> Result<Self, Self::Error> {
        let kind = serde_json::from_value(
            serde_json::json!({ "type": row.r#type, "status": row.status, "resourceAvailability": row.resource_availability }),
        )?;
        let deadline = match (
            row.publication_deadline_kind.as_str(),
            row.publication_deadline_at,
        ) {
            ("at", Some(millis)) => crate::model::Deadline::At {
                at: timestamp(millis)?,
            },
            ("unlisted", None) => crate::model::Deadline::Unlisted,
            ("closed", None) => crate::model::Deadline::Closed,
            ("unknown", None) => crate::model::Deadline::Unknown,
            _ => return Err(super::Error::InvalidData("stored deadline")),
        };
        Ok(Self {
            id: row.lms_material_id.try_into()?,
            name: row.name,
            kind,
            deadline,
            material_link_available: row.material_link_available,
            retrieved_at: None,
            archived: false,
        })
    }
}

impl TryFrom<super::entity::lms_material_resources::Model> for crate::model::Resource {
    type Error = super::Error;

    fn try_from(row: super::entity::lms_material_resources::Model) -> Result<Self, Self::Error> {
        Ok(Self {
            id: row.lms_resource_id.try_into()?,
            name: row.name,
            status: parse_enum(row.status)?,
            content: serde_json::from_value(
                serde_json::json!({ "type": row.r#type, "url": row.url }),
            )?,
            registered_on: date(row.registered_on)?,
            first_viewed_on: date(row.first_viewed_on)?,
            description: row.description,
            archived: false,
            saved_file: None,
            google_drive_file: None,
        })
    }
}

impl TryFrom<super::entity::lms_saved_files::Model> for crate::model::SavedFile {
    type Error = super::Error;

    fn try_from(row: super::entity::lms_saved_files::Model) -> Result<Self, Self::Error> {
        Ok(Self {
            content_hash: row.content_hash.try_into()?,
            original_filename: row.original_filename,
            original_size: row
                .original_size
                .try_into()
                .map_err(|_| super::Error::InvalidData("stored size"))?,
        })
    }
}

impl TryFrom<super::entity::google_drive_saved_files::Model> for crate::model::SavedFile {
    type Error = super::Error;

    fn try_from(row: super::entity::google_drive_saved_files::Model) -> Result<Self, Self::Error> {
        Ok(Self {
            content_hash: row.content_hash.try_into()?,
            original_filename: row.original_filename,
            original_size: row
                .original_size
                .try_into()
                .map_err(|_| super::Error::InvalidData("stored size"))?,
        })
    }
}

impl TryFrom<super::entity::lms_report_details::Model> for crate::model::Report {
    type Error = super::Error;

    fn try_from(row: super::entity::lms_report_details::Model) -> Result<Self, Self::Error> {
        Ok(serde_json::from_value(serde_json::json!({
            "promptHtml": row.prompt_html, "status": row.status,
            "submissionPeriodKind": row.submission_period_kind,
            "submissionStartsAt": row.submission_starts_at.map(timestamp).transpose()?,
            "submissionDueAt": row.submission_due_at.map(timestamp).transpose()?,
            "correctionMode": row.correction_mode, "correctionLimit": row.correction_limit,
            "textAnswerAllowed": row.text_answer_allowed,
            "fileAnswerAllowed": row.file_answer_allowed,
            "maxTotalFileBytes": row.max_total_file_bytes,
        }))?)
    }
}

impl From<crate::model::Course> for super::entity::lms_courses::ActiveModel {
    fn from(course: crate::model::Course) -> Self {
        let schedule = match course.schedule {
            crate::model::Schedule::Scheduled { weekday, period } => Self {
                r#type: sea_orm::ActiveValue::Set("scheduled".into()),
                weekday: sea_orm::ActiveValue::Set(Some(weekday.into())),
                period: sea_orm::ActiveValue::Set(Some(i64::from(period.get()))),
                ..Default::default()
            },
            crate::model::Schedule::Other => Self {
                r#type: sea_orm::ActiveValue::Set("other".into()),
                weekday: sea_orm::ActiveValue::Set(None),
                period: sea_orm::ActiveValue::Set(None),
                ..Default::default()
            },
            crate::model::Schedule::Unknown => Self {
                r#type: sea_orm::ActiveValue::Set("unknown".into()),
                weekday: sea_orm::ActiveValue::Set(None),
                period: sea_orm::ActiveValue::Set(None),
                ..Default::default()
            },
        };
        let access = match course.access {
            crate::model::Access::Available { id } => Self {
                availability: sea_orm::ActiveValue::Set("available".into()),
                lms_course_id: sea_orm::ActiveValue::Set(Some(id.as_ref().to_owned())),
                ..schedule
            },
            crate::model::Access::Unavailable => Self {
                availability: sea_orm::ActiveValue::Set("unavailable".into()),
                lms_course_id: sea_orm::ActiveValue::Set(None),
                ..schedule
            },
        };
        Self {
            name: sea_orm::ActiveValue::Set(course.name),
            ..access
        }
    }
}

impl TryFrom<crate::model::Material> for super::entity::lms_course_materials::ActiveModel {
    type Error = super::Error;

    fn try_from(material: crate::model::Material) -> Result<Self, Self::Error> {
        let kind = serde_json::to_value(&material.kind)?;
        let deadline = match material.deadline {
            crate::model::Deadline::At { at } => Self {
                publication_deadline_kind: sea_orm::ActiveValue::Set("at".into()),
                publication_deadline_at: sea_orm::ActiveValue::Set(Some(at.timestamp_millis())),
                ..Default::default()
            },
            crate::model::Deadline::Unlisted => Self {
                publication_deadline_kind: sea_orm::ActiveValue::Set("unlisted".into()),
                publication_deadline_at: sea_orm::ActiveValue::Set(None),
                ..Default::default()
            },
            crate::model::Deadline::Closed => Self {
                publication_deadline_kind: sea_orm::ActiveValue::Set("closed".into()),
                publication_deadline_at: sea_orm::ActiveValue::Set(None),
                ..Default::default()
            },
            crate::model::Deadline::Unknown => Self {
                publication_deadline_kind: sea_orm::ActiveValue::Set("unknown".into()),
                publication_deadline_at: sea_orm::ActiveValue::Set(None),
                ..Default::default()
            },
        };
        Ok(Self {
            lms_material_id: sea_orm::ActiveValue::Set(material.id.as_ref().to_owned()),
            name: sea_orm::ActiveValue::Set(material.name),
            r#type: sea_orm::ActiveValue::Set(
                kind["type"]
                    .as_str()
                    .ok_or(super::Error::InvalidData("material kind"))?
                    .into(),
            ),
            status: sea_orm::ActiveValue::Set(
                kind["status"]
                    .as_str()
                    .ok_or(super::Error::InvalidData("material status"))?
                    .into(),
            ),
            material_link_available: sea_orm::ActiveValue::Set(material.material_link_available),
            resource_availability: sea_orm::ActiveValue::Set(
                kind["resourceAvailability"].as_str().map(str::to_owned),
            ),
            ..deadline
        })
    }
}

impl TryFrom<crate::model::Resource> for super::entity::lms_material_resources::ActiveModel {
    type Error = super::Error;

    fn try_from(resource: crate::model::Resource) -> Result<Self, Self::Error> {
        let content = match resource.content {
            crate::model::ResourceContent::File { url } => Self {
                r#type: sea_orm::ActiveValue::Set("file".into()),
                url: sea_orm::ActiveValue::Set(url.map(|url| url.as_ref().to_string())),
                ..Default::default()
            },
            crate::model::ResourceContent::External { url } => Self {
                r#type: sea_orm::ActiveValue::Set("external".into()),
                url: sea_orm::ActiveValue::Set(Some(url.as_ref().to_string())),
                ..Default::default()
            },
            crate::model::ResourceContent::Unknown { url } => Self {
                r#type: sea_orm::ActiveValue::Set("unknown".into()),
                url: sea_orm::ActiveValue::Set(url.map(|url| url.as_ref().to_string())),
                ..Default::default()
            },
        };
        Ok(Self {
            lms_resource_id: sea_orm::ActiveValue::Set(resource.id.as_ref().to_owned()),
            name: sea_orm::ActiveValue::Set(resource.name),
            status: sea_orm::ActiveValue::Set(enum_text(&resource.status)?),
            registered_on: sea_orm::ActiveValue::Set(
                resource.registered_on.map(|date| date.to_string()),
            ),
            first_viewed_on: sea_orm::ActiveValue::Set(
                resource.first_viewed_on.map(|date| date.to_string()),
            ),
            description: sea_orm::ActiveValue::Set(resource.description),
            ..content
        })
    }
}

impl TryFrom<crate::model::Report> for super::entity::lms_report_details::ActiveModel {
    type Error = super::Error;

    fn try_from(report: crate::model::Report) -> Result<Self, Self::Error> {
        let submission = match report.submission {
            crate::model::SubmissionPeriod::At(window) => Self {
                submission_period_kind: sea_orm::ActiveValue::Set("at".into()),
                submission_starts_at: sea_orm::ActiveValue::Set(
                    window.starts_at().map(|value| value.timestamp_millis()),
                ),
                submission_due_at: sea_orm::ActiveValue::Set(
                    window.due_at().map(|value| value.timestamp_millis()),
                ),
                ..Default::default()
            },
            crate::model::SubmissionPeriod::Unlisted => Self {
                submission_period_kind: sea_orm::ActiveValue::Set("unlisted".into()),
                submission_starts_at: sea_orm::ActiveValue::Set(None),
                submission_due_at: sea_orm::ActiveValue::Set(None),
                ..Default::default()
            },
            crate::model::SubmissionPeriod::Unknown => Self {
                submission_period_kind: sea_orm::ActiveValue::Set("unknown".into()),
                submission_starts_at: sea_orm::ActiveValue::Set(None),
                submission_due_at: sea_orm::ActiveValue::Set(None),
                ..Default::default()
            },
        };
        let correction = match report.correction {
            crate::model::Correction::Unknown => Self {
                correction_mode: sea_orm::ActiveValue::Set("unknown".into()),
                correction_limit: sea_orm::ActiveValue::Set(None),
                ..submission
            },
            crate::model::Correction::NotAllowed => Self {
                correction_mode: sea_orm::ActiveValue::Set("not-allowed".into()),
                correction_limit: sea_orm::ActiveValue::Set(None),
                ..submission
            },
            crate::model::Correction::Unlimited => Self {
                correction_mode: sea_orm::ActiveValue::Set("unlimited".into()),
                correction_limit: sea_orm::ActiveValue::Set(None),
                ..submission
            },
            crate::model::Correction::Limited { limit } => Self {
                correction_mode: sea_orm::ActiveValue::Set("limited".into()),
                correction_limit: sea_orm::ActiveValue::Set(Some(
                    i64::try_from(limit)
                        .map_err(|_| super::Error::InvalidData("correction limit overflow"))?,
                )),
                ..submission
            },
        };
        Ok(Self {
            prompt_html: sea_orm::ActiveValue::Set(report.prompt_html),
            status: sea_orm::ActiveValue::Set(enum_text(&report.status)?),
            text_answer_allowed: sea_orm::ActiveValue::Set(report.text_answer_allowed),
            file_answer_allowed: sea_orm::ActiveValue::Set(report.file_answer_allowed),
            max_total_file_bytes: sea_orm::ActiveValue::Set(
                report
                    .max_total_file_bytes
                    .map(|value| {
                        i64::try_from(value)
                            .map_err(|_| super::Error::InvalidData("file size limit overflow"))
                    })
                    .transpose()?,
            ),
            ..correction
        })
    }
}

#[cfg(test)]
mod tests {
    use sea_orm::TryIntoModel as _;

    #[test]
    fn courses_preserve_access_and_schedule() {
        for access in [
            crate::model::Access::Available {
                id: "course".to_owned().try_into().unwrap(),
            },
            crate::model::Access::Unavailable,
        ] {
            for schedule in [
                crate::model::Schedule::Scheduled {
                    weekday: 7.try_into().unwrap(),
                    period: std::num::NonZeroU32::new(2).unwrap(),
                },
                crate::model::Schedule::Other,
                crate::model::Schedule::Unknown,
            ] {
                let course = crate::model::Course {
                    name: "Course".into(),
                    academic_year: 2026.try_into().unwrap(),
                    access: access.clone(),
                    schedule,
                    archived: false,
                };
                let expected = serde_json::to_value(&course).unwrap();
                let row = crate::archive::entity::lms_courses::ActiveModel {
                    retrieval_id: sea_orm::ActiveValue::Set("retrieval".into()),
                    position: sea_orm::ActiveValue::Set(0),
                    ..course.into()
                }
                .try_into_model()
                .unwrap();
                assert_eq!(
                    serde_json::to_value(row.into_course(2026, false).unwrap()).unwrap(),
                    expected
                );
            }
        }
    }

    #[test]
    fn materials_preserve_deadline_states() {
        for deadline in [
            crate::model::Deadline::At {
                at: chrono::DateTime::from_timestamp_millis(1_700_000_000_000).unwrap(),
            },
            crate::model::Deadline::Unlisted,
            crate::model::Deadline::Closed,
            crate::model::Deadline::Unknown,
        ] {
            let material = crate::model::Material {
                id: "MAT1".to_owned().try_into().unwrap(),
                name: "Material".into(),
                kind: crate::model::MaterialKind::Material {
                    status: crate::model::DocumentStatus::Viewed,
                    resource_availability: crate::model::Availability::Available,
                },
                deadline,
                material_link_available: true,
                retrieved_at: None,
                archived: false,
            };
            let expected = serde_json::to_value(&material).unwrap();
            let row = crate::archive::entity::lms_course_materials::ActiveModel {
                retrieval_id: sea_orm::ActiveValue::Set("retrieval".into()),
                position: sea_orm::ActiveValue::Set(0),
                folder_position: sea_orm::ActiveValue::Set(0),
                ..material.try_into().unwrap()
            }
            .try_into_model()
            .unwrap();
            assert_eq!(
                serde_json::to_value(crate::model::Material::try_from(row).unwrap()).unwrap(),
                expected
            );
        }
    }

    #[test]
    fn resources_preserve_content_and_optional_urls() {
        let url: crate::model::WebUrl = "https://example.com/file".to_owned().try_into().unwrap();
        for content in [
            crate::model::ResourceContent::File { url: None },
            crate::model::ResourceContent::File {
                url: Some(url.clone()),
            },
            crate::model::ResourceContent::External { url: url.clone() },
            crate::model::ResourceContent::Unknown { url: None },
            crate::model::ResourceContent::Unknown { url: Some(url) },
        ] {
            let resource = crate::model::Resource {
                id: "SRS1".to_owned().try_into().unwrap(),
                name: "Resource".into(),
                status: crate::model::ResourceStatus::Viewed,
                content,
                registered_on: chrono::NaiveDate::from_ymd_opt(2026, 11, 12),
                first_viewed_on: None,
                description: Some("Description".into()),
                archived: false,
                saved_file: None,
                google_drive_file: None,
            };
            let expected = serde_json::to_value(&resource).unwrap();
            let row = crate::archive::entity::lms_material_resources::ActiveModel {
                retrieval_id: sea_orm::ActiveValue::Set("retrieval".into()),
                position: sea_orm::ActiveValue::Set(0),
                ..resource.try_into().unwrap()
            }
            .try_into_model()
            .unwrap();
            assert_eq!(
                serde_json::to_value(crate::model::Resource::try_from(row).unwrap()).unwrap(),
                expected
            );
        }
    }

    #[test]
    fn reports_preserve_submission_and_correction_states() {
        for submission in [
            crate::model::SubmissionPeriod::At(
                crate::model::SubmissionWindow::new(
                    chrono::DateTime::from_timestamp_millis(1_700_000_000_000),
                    None,
                )
                .unwrap(),
            ),
            crate::model::SubmissionPeriod::Unlisted,
            crate::model::SubmissionPeriod::Unknown,
        ] {
            for correction in [
                crate::model::Correction::Unknown,
                crate::model::Correction::NotAllowed,
                crate::model::Correction::Unlimited,
                crate::model::Correction::Limited { limit: 3 },
            ] {
                let report = crate::model::Report {
                    prompt_html: Some("<p>Report</p>".into()),
                    status: crate::model::ReportStatus::Unsubmitted,
                    submission: submission.clone(),
                    correction,
                    text_answer_allowed: Some(true),
                    file_answer_allowed: Some(false),
                    max_total_file_bytes: Some(1024),
                    retrieved_at: None,
                };
                let expected = serde_json::to_value(&report).unwrap();
                let row = crate::archive::entity::lms_report_details::ActiveModel {
                    retrieval_id: sea_orm::ActiveValue::Set("retrieval".into()),
                    ..report.try_into().unwrap()
                }
                .try_into_model()
                .unwrap();
                assert_eq!(
                    serde_json::to_value(crate::model::Report::try_from(row).unwrap()).unwrap(),
                    expected
                );
            }
        }
    }
}
