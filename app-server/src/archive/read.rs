use sea_orm::ColumnTrait as _;
use sea_orm::EntityTrait as _;
use sea_orm::QueryFilter as _;
use sea_orm::QueryOrder as _;

pub async fn courses(
    connection: &impl sea_orm::ConnectionTrait,
) -> Result<Vec<crate::model::Course>, super::Error> {
    let retrievals = super::entity::lms_course_retrievals::Entity::find()
        .order_by_desc(super::entity::lms_course_retrievals::Column::TimestampMillis)
        .order_by_desc(super::entity::lms_course_retrievals::Column::TimestampCounter)
        .order_by_desc(super::entity::lms_course_retrievals::Column::Id)
        .all(connection)
        .await?;
    if retrievals.is_empty() {
        return Err(super::Error::Missing);
    }
    let mut latest_years = std::collections::HashSet::new();
    let mut seen = std::collections::HashSet::new();
    let mut courses = Vec::new();
    for retrieval in retrievals {
        let current = latest_years.insert(retrieval.academic_year);
        let rows = super::entity::lms_courses::Entity::find()
            .filter(super::entity::lms_courses::Column::RetrievalId.eq(&retrieval.id))
            .order_by_asc(super::entity::lms_courses::Column::Position)
            .all(connection)
            .await?;
        for row in rows {
            let new = row
                .lms_course_id
                .as_ref()
                .is_some_and(|id| seen.insert((retrieval.academic_year, id.clone())));
            if current || new {
                courses.push(row.into_course(retrieval.academic_year, !current)?);
            }
        }
    }
    Ok(courses)
}

struct MaterialPosition {
    folder: usize,
    material: usize,
}

pub async fn course_materials(
    connection: &impl sea_orm::ConnectionTrait,
    course: &crate::model::CourseId,
) -> Result<crate::model::CourseMaterials, super::Error> {
    let retrievals = super::entity::lms_course_material_retrievals::Entity::find()
        .filter(
            super::entity::lms_course_material_retrievals::Column::LmsCourseId.eq(course.as_ref()),
        )
        .order_by_desc(super::entity::lms_course_material_retrievals::Column::TimestampMillis)
        .order_by_desc(super::entity::lms_course_material_retrievals::Column::TimestampCounter)
        .order_by_desc(super::entity::lms_course_material_retrievals::Column::Id)
        .all(connection)
        .await?;
    let latest = retrievals.first().ok_or(super::Error::Missing)?.id.clone();
    let archived = match courses(connection).await {
        Ok(courses) => courses
            .iter()
            .any(|known| known.id() == Some(course) && known.archived),
        Err(super::Error::Missing) => false,
        Err(error) => return Err(error),
    };
    let mut result = crate::model::CourseMaterials {
        course_id: course.clone(),
        folders: Vec::new(),
    };
    let mut seen = std::collections::HashSet::new();
    let mut inaccessible =
        std::collections::HashMap::<crate::model::MaterialId, MaterialPosition>::new();
    for retrieval in retrievals {
        let folders = super::entity::lms_course_material_folders::Entity::find()
            .filter(
                super::entity::lms_course_material_folders::Column::RetrievalId.eq(&retrieval.id),
            )
            .order_by_asc(super::entity::lms_course_material_folders::Column::Position)
            .all(connection)
            .await?;
        let mut definitions = std::collections::HashMap::new();
        let mut indices = std::collections::HashMap::new();
        for folder in folders {
            let definition = crate::model::Folder {
                name: folder.name,
                class_date: super::mapping::date(folder.class_date)?,
                description_html: folder.description_html,
                materials: Vec::new(),
            };
            if retrieval.id == latest {
                indices.insert(folder.position, result.folders.len());
                result.folders.push(definition);
            } else {
                definitions.insert(folder.position, definition);
            }
        }
        let rows = super::entity::lms_course_materials::Entity::find()
            .filter(super::entity::lms_course_materials::Column::RetrievalId.eq(&retrieval.id))
            .order_by_asc(super::entity::lms_course_materials::Column::Position)
            .all(connection)
            .await?;
        for row in rows {
            let folder_position = row.folder_position;
            let mut material: crate::model::Material = row.try_into()?;
            if !seen.insert(material.id.clone()) {
                if !material.inaccessible()
                    && let Some(position) = inaccessible.remove(&material.id)
                {
                    let current = &mut result.folders[position.folder].materials[position.material];
                    current.name = material.name;
                    current.deadline = material.deadline;
                }
                continue;
            }
            let folder_index = if let Some(index) = indices.get(&folder_position) {
                *index
            } else {
                let definition = definitions
                    .get(&folder_position)
                    .ok_or(super::Error::InvalidData("stored folder"))?;
                let index = result
                    .folders
                    .iter()
                    .position(|folder| {
                        folder.name == definition.name && folder.class_date == definition.class_date
                    })
                    .unwrap_or_else(|| {
                        result.folders.push(definition.clone());
                        result.folders.len() - 1
                    });
                indices.insert(folder_position, index);
                index
            };
            material.archived = archived || retrieval.id != latest || material.inaccessible();
            if material.inaccessible() {
                inaccessible.insert(
                    material.id.clone(),
                    MaterialPosition {
                        folder: folder_index,
                        material: result.folders[folder_index].materials.len(),
                    },
                );
            }
            if matches!(material.kind, crate::model::MaterialKind::Material { .. }) {
                material.retrieved_at = latest_resources(connection, &material.id)
                    .await?
                    .map(|row| super::mapping::timestamp(row.retrieved_at))
                    .transpose()?;
            }
            result.folders[folder_index].materials.push(material);
        }
    }
    Ok(result)
}

pub async fn find_course_for_material(
    connection: &impl sea_orm::ConnectionTrait,
    material: &crate::model::MaterialId,
) -> Result<Option<crate::model::CourseId>, super::Error> {
    let rows = super::entity::lms_course_materials::Entity::find()
        .filter(super::entity::lms_course_materials::Column::LmsMaterialId.eq(material.as_ref()))
        .all(connection)
        .await?;
    let retrieval = super::entity::lms_course_material_retrievals::Entity::find()
        .filter(
            super::entity::lms_course_material_retrievals::Column::Id
                .is_in(rows.into_iter().map(|row| row.retrieval_id)),
        )
        .order_by_desc(super::entity::lms_course_material_retrievals::Column::TimestampMillis)
        .order_by_desc(super::entity::lms_course_material_retrievals::Column::TimestampCounter)
        .order_by_desc(super::entity::lms_course_material_retrievals::Column::Id)
        .one(connection)
        .await?;
    Ok(retrieval
        .map(|row| row.lms_course_id.try_into())
        .transpose()?)
}

async fn latest_resources(
    connection: &impl sea_orm::ConnectionTrait,
    material: &crate::model::MaterialId,
) -> Result<Option<super::entity::lms_material_resource_retrievals::Model>, super::Error> {
    Ok(
        super::entity::lms_material_resource_retrievals::Entity::find()
            .filter(
                super::entity::lms_material_resource_retrievals::Column::LmsMaterialId
                    .eq(material.as_ref()),
            )
            .order_by_desc(super::entity::lms_material_resource_retrievals::Column::TimestampMillis)
            .order_by_desc(
                super::entity::lms_material_resource_retrievals::Column::TimestampCounter,
            )
            .order_by_desc(super::entity::lms_material_resource_retrievals::Column::Id)
            .one(connection)
            .await?,
    )
}

pub async fn material_detail(
    connection: &impl sea_orm::ConnectionTrait,
    id: &crate::model::MaterialId,
) -> Result<crate::model::Detail, super::Error> {
    let course_id = find_course_for_material(connection, id)
        .await?
        .ok_or(super::Error::Missing)?;
    let course = courses(connection)
        .await?
        .into_iter()
        .find(|course| course.id() == Some(&course_id))
        .ok_or(super::Error::Missing)?;
    let material = course_materials(connection, &course_id)
        .await?
        .folders
        .into_iter()
        .flat_map(|folder| folder.materials)
        .find(|material| &material.id == id)
        .ok_or(super::Error::Missing)?;
    let mut resources = Vec::new();
    let retrievals = super::entity::lms_material_resource_retrievals::Entity::find()
        .filter(
            super::entity::lms_material_resource_retrievals::Column::LmsMaterialId.eq(id.as_ref()),
        )
        .order_by_desc(super::entity::lms_material_resource_retrievals::Column::TimestampMillis)
        .order_by_desc(super::entity::lms_material_resource_retrievals::Column::TimestampCounter)
        .order_by_desc(super::entity::lms_material_resource_retrievals::Column::Id)
        .all(connection)
        .await?;
    if retrievals.is_empty()
        && matches!(material.kind, crate::model::MaterialKind::Material { .. })
        && !material.archived
    {
        return Err(super::Error::Missing);
    }
    let saved = super::entity::lms_saved_files::Entity::find()
        .filter(super::entity::lms_saved_files::Column::LmsMaterialId.eq(id.as_ref()))
        .all(connection)
        .await?
        .into_iter()
        .map(|row| {
            Ok((
                row.lms_resource_id.clone(),
                crate::model::SavedFile::try_from(row)?,
            ))
        })
        .collect::<Result<std::collections::HashMap<_, _>, super::Error>>()?;
    let mut seen = std::collections::HashSet::new();
    for (index, retrieval) in retrievals.into_iter().enumerate() {
        let rows = super::entity::lms_material_resources::Entity::find()
            .filter(super::entity::lms_material_resources::Column::RetrievalId.eq(retrieval.id))
            .order_by_asc(super::entity::lms_material_resources::Column::Position)
            .all(connection)
            .await?;
        for row in rows {
            if !seen.insert(row.lms_resource_id.clone()) {
                continue;
            }
            let mut resource: crate::model::Resource = row.try_into()?;
            resource.archived = material.archived || index != 0;
            match &resource.content {
                crate::model::ResourceContent::File { .. } => {
                    resource.saved_file = saved.get(resource.id.as_ref()).cloned();
                }
                crate::model::ResourceContent::External { url } => {
                    if let Ok(url) =
                        crate::model::GoogleDriveUrl::try_from(url.as_ref().to_string())
                    {
                        let id = url.file_id();
                        let saved_file =
                            super::entity::google_drive_saved_files::Entity::find_by_id(
                                id.as_ref(),
                            )
                            .one(connection)
                            .await?
                            .map(TryInto::try_into)
                            .transpose()?;
                        resource.google_drive_file =
                            Some(crate::model::GoogleDriveFile { id, saved_file });
                    }
                }
                crate::model::ResourceContent::Unknown { .. } => (),
            }
            resources.push(resource);
        }
    }
    let mut report = None;
    if matches!(material.kind, crate::model::MaterialKind::Report { .. }) {
        let retrieval = super::entity::lms_report_detail_retrievals::Entity::find()
            .filter(
                super::entity::lms_report_detail_retrievals::Column::LmsMaterialId.eq(id.as_ref()),
            )
            .order_by_desc(super::entity::lms_report_detail_retrievals::Column::TimestampMillis)
            .order_by_desc(super::entity::lms_report_detail_retrievals::Column::TimestampCounter)
            .order_by_desc(super::entity::lms_report_detail_retrievals::Column::Id)
            .one(connection)
            .await?;
        if let Some(retrieval) = retrieval {
            let row = super::entity::lms_report_details::Entity::find_by_id(retrieval.id)
                .one(connection)
                .await?
                .ok_or(super::Error::InvalidData("stored report"))?;
            let mut detail: crate::model::Report = row.try_into()?;
            detail.retrieved_at = Some(super::mapping::timestamp(retrieval.retrieved_at)?);
            report = Some(detail);
        }
    }
    Ok(crate::model::Detail {
        course,
        material,
        resources,
        report,
    })
}
