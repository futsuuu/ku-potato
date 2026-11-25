use sea_orm::ActiveModelTrait as _;

pub async fn append(
    connection: &sea_orm::DatabaseTransaction,
    timestamp: super::Timestamp,
    snapshot: crate::model::Snapshot,
) -> Result<Option<super::ResourceRetrieval>, super::Error> {
    if let Some(listing) = snapshot.courses {
        let id = uuid::Uuid::new_v4().to_string();
        super::entity::lms_course_retrievals::ActiveModel {
            id: sea_orm::ActiveValue::Set(id.clone()),
            retrieved_at: sea_orm::ActiveValue::Set(timestamp.retrieved_at_millis),
            timestamp_millis: sea_orm::ActiveValue::Set(timestamp.logical_millis),
            timestamp_counter: sea_orm::ActiveValue::Set(timestamp.logical_counter),
            academic_year: sea_orm::ActiveValue::Set(listing.academic_year.into()),
        }
        .insert(connection)
        .await?;

        for (position, course) in listing.entries.into_iter().enumerate() {
            super::entity::lms_courses::ActiveModel {
                retrieval_id: sea_orm::ActiveValue::Set(id.clone()),
                position: sea_orm::ActiveValue::Set(position as i64),
                ..course.into()
            }
            .insert(connection)
            .await?;
        }
    }
    if let Some(materials) = snapshot.materials {
        let id = uuid::Uuid::new_v4().to_string();
        super::entity::lms_course_material_retrievals::ActiveModel {
            id: sea_orm::ActiveValue::Set(id.clone()),
            retrieved_at: sea_orm::ActiveValue::Set(timestamp.retrieved_at_millis),
            timestamp_millis: sea_orm::ActiveValue::Set(timestamp.logical_millis),
            timestamp_counter: sea_orm::ActiveValue::Set(timestamp.logical_counter),
            lms_course_id: sea_orm::ActiveValue::Set(materials.course_id.as_ref().to_owned()),
        }
        .insert(connection)
        .await?;

        let mut position = 0;
        for (folder_position, folder) in materials.folders.into_iter().enumerate() {
            super::entity::lms_course_material_folders::ActiveModel {
                retrieval_id: sea_orm::ActiveValue::Set(id.clone()),
                position: sea_orm::ActiveValue::Set(folder_position as i64),
                name: sea_orm::ActiveValue::Set(folder.name),
                class_date: sea_orm::ActiveValue::Set(
                    folder.class_date.map(|date| date.to_string()),
                ),
                description_html: sea_orm::ActiveValue::Set(folder.description_html),
            }
            .insert(connection)
            .await?;
            for material in folder.materials {
                super::entity::lms_course_materials::ActiveModel {
                    retrieval_id: sea_orm::ActiveValue::Set(id.clone()),
                    position: sea_orm::ActiveValue::Set(position),
                    folder_position: sea_orm::ActiveValue::Set(folder_position as i64),
                    ..material.try_into()?
                }
                .insert(connection)
                .await?;
                position += 1;
            }
        }
    }
    let mut resource_retrieval = None;
    if let Some(contents) = snapshot.contents {
        if let Some(resources) = contents.resources {
            let id = uuid::Uuid::new_v4().to_string();
            super::entity::lms_material_resource_retrievals::ActiveModel {
                id: sea_orm::ActiveValue::Set(id.clone()),
                retrieved_at: sea_orm::ActiveValue::Set(timestamp.retrieved_at_millis),
                timestamp_millis: sea_orm::ActiveValue::Set(timestamp.logical_millis),
                timestamp_counter: sea_orm::ActiveValue::Set(timestamp.logical_counter),
                lms_material_id: sea_orm::ActiveValue::Set(
                    contents.material_id.as_ref().to_owned(),
                ),
            }
            .insert(connection)
            .await?;

            for (position, resource) in resources.into_iter().enumerate() {
                super::entity::lms_material_resources::ActiveModel {
                    retrieval_id: sea_orm::ActiveValue::Set(id.clone()),
                    position: sea_orm::ActiveValue::Set(position as i64),
                    ..resource.try_into()?
                }
                .insert(connection)
                .await?;
            }
            resource_retrieval = Some(super::ResourceRetrieval {
                id,
                material_id: contents.material_id.clone(),
            });
        }
        if let Some(report) = contents.report {
            let id = uuid::Uuid::new_v4().to_string();
            super::entity::lms_report_detail_retrievals::ActiveModel {
                id: sea_orm::ActiveValue::Set(id.clone()),
                retrieved_at: sea_orm::ActiveValue::Set(timestamp.retrieved_at_millis),
                timestamp_millis: sea_orm::ActiveValue::Set(timestamp.logical_millis),
                timestamp_counter: sea_orm::ActiveValue::Set(timestamp.logical_counter),
                lms_material_id: sea_orm::ActiveValue::Set(
                    contents.material_id.as_ref().to_owned(),
                ),
            }
            .insert(connection)
            .await?;

            super::entity::lms_report_details::ActiveModel {
                retrieval_id: sea_orm::ActiveValue::Set(id),
                ..report.try_into()?
            }
            .insert(connection)
            .await?;
        }
    }
    Ok(resource_retrieval)
}
