mod entity;
mod mapping;
mod read;
mod write;

use sea_orm::ActiveModelTrait as _;
use sea_orm::ColumnTrait as _;
use sea_orm::ConnectionTrait as _;
use sea_orm::EntityTrait as _;
use sea_orm::QueryFilter as _;
use sea_orm::TransactionTrait as _;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("No saved data is available")]
    Missing,
    #[error(transparent)]
    Database(#[from] sea_orm::DbErr),
    #[error("Invalid archive data: {0}")]
    InvalidData(&'static str),
    #[error("Invalid archive data: {0}")]
    InvalidValue(#[from] crate::model::InvalidValue),
    #[error("Could not encode or decode archive data: {0}")]
    Serialization(#[from] serde_json::Error),
    #[error("The database path must be UTF-8")]
    InvalidPath,
}

#[derive(Clone, Debug)]
pub struct ResourceRetrieval {
    pub id: String,
    pub material_id: crate::model::MaterialId,
}

struct Timestamp {
    retrieved_at_millis: i64,
    logical_millis: i64,
    logical_counter: i64,
}

#[derive(Clone)]
pub struct Store {
    connection: sea_orm::DatabaseConnection,
}

impl Store {
    pub async fn open_path(path: &std::path::Path) -> Result<Self, Error> {
        let path = path.to_str().ok_or(Error::InvalidPath)?;
        let path = percent_encoding::utf8_percent_encode(path, percent_encoding::NON_ALPHANUMERIC);
        Self::open(&format!("sqlite://{path}?mode=rwc")).await
    }

    pub async fn open(url: &str) -> Result<Self, Error> {
        let mut options = sea_orm::ConnectOptions::new(url);
        options.max_connections(1).sqlx_logging(false);
        let connection = sea_orm::Database::connect(options).await?;
        connection
            .execute_unprepared(
                "PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;",
            )
            .await?;
        connection
            .execute_unprepared(include_str!("archive/schema.sql"))
            .await?;
        Ok(Self { connection })
    }

    pub async fn append(
        &self,
        snapshot: crate::model::Snapshot,
    ) -> Result<Option<ResourceRetrieval>, Error> {
        let transaction = self.connection.begin().await?;
        let timestamp = next_timestamp(&transaction).await?;
        let resource_retrieval = write::append(&transaction, timestamp, snapshot).await?;
        transaction.commit().await?;
        Ok(resource_retrieval)
    }

    pub async fn courses(&self) -> Result<Vec<crate::model::Course>, Error> {
        let transaction = self.connection.begin().await?;
        read::courses(&transaction).await
    }

    pub async fn course_materials(
        &self,
        course: &crate::model::CourseId,
    ) -> Result<crate::model::CourseMaterials, Error> {
        let transaction = self.connection.begin().await?;
        read::course_materials(&transaction, course).await
    }

    pub async fn find_course_for_material(
        &self,
        material: &crate::model::MaterialId,
    ) -> Result<Option<crate::model::CourseId>, Error> {
        read::find_course_for_material(&self.connection, material).await
    }

    pub async fn material_detail(
        &self,
        material: &crate::model::MaterialId,
    ) -> Result<crate::model::Detail, Error> {
        let transaction = self.connection.begin().await?;
        read::material_detail(&transaction, material).await
    }

    pub async fn saved_file(
        &self,
        material: &crate::model::MaterialId,
        resource: &crate::model::ResourceId,
    ) -> Result<crate::model::SavedFile, Error> {
        entity::saved_files::Entity::find_by_id((
            material.as_ref().to_owned(),
            resource.as_ref().to_owned(),
        ))
        .one(&self.connection)
        .await?
        .ok_or(Error::Missing)?
        .try_into()
    }

    pub async fn references_content(
        &self,
        hash: &crate::model::ContentHash,
    ) -> Result<bool, Error> {
        Ok(entity::saved_files::Entity::find()
            .filter(entity::saved_files::Column::ContentHash.eq(hash.as_ref()))
            .one(&self.connection)
            .await?
            .is_some())
    }

    pub async fn replace_saved_file(
        &self,
        retrieval: ResourceRetrieval,
        resource: &crate::model::ResourceId,
        file: &crate::model::SavedFile,
    ) -> Result<Option<crate::model::SavedFile>, Error> {
        let transaction = self.connection.begin().await?;
        let previous = entity::saved_files::Entity::find_by_id((
            retrieval.material_id.as_ref().to_owned(),
            resource.as_ref().to_owned(),
        ))
        .one(&transaction)
        .await?
        .map(TryInto::try_into)
        .transpose()?;
        let timestamp = next_timestamp(&transaction).await?;
        entity::saved_files::Entity::insert(entity::saved_files::ActiveModel {
            lms_material_id: sea_orm::ActiveValue::Set(retrieval.material_id.as_ref().to_owned()),
            lms_resource_id: sea_orm::ActiveValue::Set(resource.as_ref().to_owned()),
            content_hash: sea_orm::ActiveValue::Set(file.content_hash.as_ref().to_owned()),
            original_filename: sea_orm::ActiveValue::Set(file.original_filename.clone()),
            original_size: sea_orm::ActiveValue::Set(
                i64::try_from(file.original_size).map_err(|_| Error::InvalidData("file size"))?,
            ),
            resource_retrieval_id: sea_orm::ActiveValue::Set(retrieval.id),
            timestamp_millis: sea_orm::ActiveValue::Set(timestamp.logical_millis),
            timestamp_counter: sea_orm::ActiveValue::Set(timestamp.logical_counter),
        })
        .on_conflict(
            sea_orm::sea_query::OnConflict::columns([
                entity::saved_files::Column::LmsMaterialId,
                entity::saved_files::Column::LmsResourceId,
            ])
            .update_columns([
                entity::saved_files::Column::ContentHash,
                entity::saved_files::Column::OriginalFilename,
                entity::saved_files::Column::OriginalSize,
                entity::saved_files::Column::ResourceRetrievalId,
                entity::saved_files::Column::TimestampMillis,
                entity::saved_files::Column::TimestampCounter,
            ])
            .to_owned(),
        )
        .exec(&transaction)
        .await?;
        transaction.commit().await?;
        Ok(previous)
    }
}

async fn next_timestamp(connection: &sea_orm::DatabaseTransaction) -> Result<Timestamp, Error> {
    let now = chrono::Utc::now().timestamp_millis().max(0);
    let clock = entity::archive_state::Entity::find_by_id(1)
        .one(connection)
        .await?
        .ok_or(Error::InvalidData("archive clock"))?;
    let timestamp = Timestamp {
        retrieved_at_millis: now,
        logical_millis: now.max(clock.clock_millis),
        logical_counter: if now > clock.clock_millis {
            0
        } else {
            clock
                .clock_counter
                .checked_add(1)
                .ok_or(Error::InvalidData("archive clock overflow"))?
        },
    };
    entity::archive_state::ActiveModel {
        singleton: sea_orm::ActiveValue::Set(1),
        clock_millis: sea_orm::ActiveValue::Set(timestamp.logical_millis),
        clock_counter: sea_orm::ActiveValue::Set(timestamp.logical_counter),
    }
    .update(connection)
    .await?;
    Ok(timestamp)
}

#[cfg(test)]
mod tests {
    use sea_orm::ConnectionTrait as _;
    use sea_orm::EntityTrait as _;

    fn course(id: &str) -> crate::model::Course {
        crate::model::Course {
            name: id.into(),
            academic_year: 2026.try_into().unwrap(),
            access: crate::model::Access::Available {
                id: id.to_owned().try_into().unwrap(),
            },
            schedule: crate::model::Schedule::Scheduled {
                weekday: 1.try_into().unwrap(),
                period: std::num::NonZeroU32::new(2).unwrap(),
            },
            archived: false,
        }
    }

    fn material(id: &str, name: &str) -> crate::model::Material {
        crate::model::Material {
            id: id.to_owned().try_into().unwrap(),
            name: name.into(),
            kind: crate::model::MaterialKind::Material {
                status: crate::model::DocumentStatus::Unviewed,
                resource_availability: crate::model::Availability::Available,
            },
            deadline: crate::model::Deadline::Unlisted,
            material_link_available: true,
            retrieved_at: None,
            archived: false,
        }
    }

    fn listing(materials: Vec<crate::model::Material>) -> crate::model::CourseMaterials {
        crate::model::CourseMaterials {
            course_id: "course1".to_owned().try_into().unwrap(),
            folders: vec![crate::model::Folder {
                name: "week 1".into(),
                class_date: None,
                description_html: Some("<p>description</p>".into()),
                materials,
            }],
        }
    }

    fn resource(id: &str) -> crate::model::Resource {
        crate::model::Resource {
            id: id.to_owned().try_into().unwrap(),
            name: id.into(),
            status: crate::model::ResourceStatus::Viewed,
            content: crate::model::ResourceContent::File {
                url: Some(
                    "https://example.com/download"
                        .to_owned()
                        .try_into()
                        .unwrap(),
                ),
            },
            registered_on: Some(chrono::NaiveDate::from_ymd_opt(2026, 11, 12).unwrap()),
            first_viewed_on: None,
            description: None,
            archived: false,
            saved_file: None,
        }
    }

    fn snapshot(
        materials: Vec<crate::model::Material>,
        resources: Option<Vec<crate::model::Resource>>,
    ) -> crate::model::Snapshot {
        crate::model::Snapshot {
            courses: Some(crate::model::CourseListing {
                academic_year: 2026.try_into().unwrap(),
                entries: vec![course("course1")],
            }),
            materials: Some(listing(materials)),
            contents: resources.map(|resources| crate::model::MaterialContents {
                material_id: "MAT1".to_owned().try_into().unwrap(),
                resources: Some(resources),
                report: None,
            }),
        }
    }

    #[tokio::test]
    async fn empty_retrievals_are_not_missing_and_history_is_retained() {
        let store = super::Store::open("sqlite::memory:").await.unwrap();
        assert!(matches!(store.courses().await, Err(super::Error::Missing)));
        store
            .append(snapshot(
                vec![material("MAT1", "original"), material("MAT2", "removed")],
                Some(vec![resource("SRS1"), resource("SRS2")]),
            ))
            .await
            .unwrap();
        store
            .append(snapshot(
                vec![material("MAT1", "updated")],
                Some(vec![resource("SRS1")]),
            ))
            .await
            .unwrap();
        let detail = store
            .material_detail(&"MAT1".to_owned().try_into().unwrap())
            .await
            .unwrap();
        assert_eq!(detail.material.name, "updated");
        assert!(!detail.resources[0].archived);
        assert!(detail.resources[1].archived);
        let course_id = "course1".to_owned().try_into().unwrap();
        let materials = store.course_materials(&course_id).await.unwrap();
        assert!(materials.folders[0].materials[1].archived);
        store
            .append(snapshot(Vec::new(), Some(Vec::new())))
            .await
            .unwrap();
        let detail = store
            .material_detail(&"MAT1".to_owned().try_into().unwrap())
            .await
            .unwrap();
        assert!(detail.material.archived);
        assert!(detail.resources.iter().all(|resource| resource.archived));
        store
            .append(crate::model::Snapshot {
                courses: Some(crate::model::CourseListing {
                    academic_year: 2026.try_into().unwrap(),
                    entries: Vec::new(),
                }),
                materials: None,
                contents: None,
            })
            .await
            .unwrap();
        assert!(store.courses().await.unwrap()[0].archived);
        assert_eq!(
            store.course_materials(&course_id).await.unwrap().folders[0].materials[0].name,
            "updated"
        );
        let empty = super::Store::open("sqlite::memory:").await.unwrap();
        empty
            .append(crate::model::Snapshot {
                courses: Some(crate::model::CourseListing {
                    academic_year: 2026.try_into().unwrap(),
                    entries: Vec::new(),
                }),
                materials: Some(listing(Vec::new())),
                contents: None,
            })
            .await
            .unwrap();
        assert!(empty.courses().await.unwrap().is_empty());
        assert!(
            empty.course_materials(&course_id).await.unwrap().folders[0]
                .materials
                .is_empty()
        );
    }

    #[tokio::test]
    async fn closed_materials_preserve_accessible_metadata() {
        let store = super::Store::open("sqlite::memory:").await.unwrap();
        store
            .append(snapshot(
                vec![material("MAT1", "original")],
                Some(Vec::new()),
            ))
            .await
            .unwrap();
        let mut closed = material("MAT1", "private placeholder");
        closed.deadline = crate::model::Deadline::Closed;
        closed.material_link_available = false;
        store.append(snapshot(vec![closed], None)).await.unwrap();
        let detail = store
            .material_detail(&"MAT1".to_owned().try_into().unwrap())
            .await
            .unwrap();
        assert_eq!(detail.material.name, "original");
        assert!(matches!(
            detail.material.deadline,
            crate::model::Deadline::Unlisted
        ));
        assert!(detail.material.archived);
        assert!(!detail.material.material_link_available);
    }

    #[tokio::test]
    async fn failed_snapshots_and_file_references_roll_back_atomically() {
        let store = super::Store::open("sqlite::memory:").await.unwrap();
        store
            .append(snapshot(
                vec![material("MAT1", "original")],
                Some(Vec::new()),
            ))
            .await
            .unwrap();
        let clock = super::entity::archive_state::Entity::find_by_id(1)
            .one(&store.connection)
            .await
            .unwrap()
            .unwrap();
        assert!(
            store
                .append(snapshot(
                    vec![material("MAT1", "corrupted")],
                    Some(vec![resource("SRS1"), resource("SRS1")])
                ))
                .await
                .is_err()
        );
        assert_eq!(
            store
                .material_detail(&"MAT1".to_owned().try_into().unwrap())
                .await
                .unwrap()
                .material
                .name,
            "original"
        );
        assert_eq!(
            super::entity::archive_state::Entity::find_by_id(1)
                .one(&store.connection)
                .await
                .unwrap()
                .unwrap(),
            clock
        );
        let metadata = crate::model::SavedFile {
            content_hash: "0".repeat(64).try_into().unwrap(),
            original_filename: "file.pdf".into(),
            original_size: 10,
        };
        assert!(
            store
                .replace_saved_file(
                    super::ResourceRetrieval {
                        id: "missing".into(),
                        material_id: "MAT1".to_owned().try_into().unwrap(),
                    },
                    &"SRS1".to_owned().try_into().unwrap(),
                    &metadata
                )
                .await
                .is_err()
        );
        assert!(
            store
                .saved_file(
                    &"MAT1".to_owned().try_into().unwrap(),
                    &"SRS1".to_owned().try_into().unwrap()
                )
                .await
                .is_err()
        );
    }

    #[tokio::test]
    async fn saved_files_survive_new_empty_retrievals_and_reject_cross_material_references() {
        let store = super::Store::open("sqlite::memory:").await.unwrap();
        let retrieval = store
            .append(snapshot(
                vec![material("MAT1", "original")],
                Some(vec![resource("SRS1")]),
            ))
            .await
            .unwrap()
            .unwrap();
        let material_id = "MAT1".to_owned().try_into().unwrap();
        let resource_id = "SRS1".to_owned().try_into().unwrap();
        let file = crate::model::SavedFile {
            content_hash: "0".repeat(64).try_into().unwrap(),
            original_filename: "report.pdf".into(),
            original_size: 100,
        };
        assert!(
            store
                .replace_saved_file(
                    super::ResourceRetrieval {
                        material_id: "MAT2".to_owned().try_into().unwrap(),
                        ..retrieval.clone()
                    },
                    &resource_id,
                    &file
                )
                .await
                .is_err()
        );
        assert!(
            store
                .replace_saved_file(retrieval.clone(), &resource_id, &file)
                .await
                .unwrap()
                .is_none()
        );
        assert!(store.references_content(&file.content_hash).await.unwrap());
        let mut updated = file.clone();
        updated.content_hash = "1".repeat(64).try_into().unwrap();
        let previous = store
            .replace_saved_file(retrieval, &resource_id, &updated)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(previous.content_hash, file.content_hash);
        assert!(!store.references_content(&file.content_hash).await.unwrap());
        assert!(
            store
                .references_content(&updated.content_hash)
                .await
                .unwrap()
        );
        store
            .append(snapshot(
                vec![material("MAT1", "original")],
                Some(Vec::new()),
            ))
            .await
            .unwrap();
        let detail = store.material_detail(&material_id).await.unwrap();
        assert!(detail.resources[0].archived);
        assert_eq!(
            detail.resources[0]
                .saved_file
                .as_ref()
                .unwrap()
                .content_hash,
            updated.content_hash
        );
        assert_eq!(
            store
                .saved_file(&material_id, &resource_id)
                .await
                .unwrap()
                .content_hash,
            updated.content_hash
        );
    }

    #[tokio::test]
    async fn logical_clock_orders_retrievals_after_wall_clock_moves_backward() {
        let store = super::Store::open("sqlite::memory:").await.unwrap();
        store
            .connection
            .execute_unprepared(
                "UPDATE archive_state SET clock_millis = 9000000000000, clock_counter = 10",
            )
            .await
            .unwrap();
        store
            .append(snapshot(vec![material("MAT1", "first")], Some(Vec::new())))
            .await
            .unwrap();
        store
            .append(snapshot(vec![material("MAT1", "second")], Some(Vec::new())))
            .await
            .unwrap();
        assert_eq!(
            store
                .material_detail(&"MAT1".to_owned().try_into().unwrap())
                .await
                .unwrap()
                .material
                .name,
            "second"
        );
        let clock = super::entity::archive_state::Entity::find_by_id(1)
            .one(&store.connection)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(clock.clock_millis, 9000000000000);
        assert_eq!(clock.clock_counter, 12);
    }

    #[tokio::test]
    async fn nullable_fields_match_their_material_and_resource_kinds() {
        let store = super::Store::open("sqlite::memory:").await.unwrap();
        store
            .append(snapshot(
                vec![material("MAT1", "material")],
                Some(vec![resource("SRS1")]),
            ))
            .await
            .unwrap();
        for statement in [
            "UPDATE course_materials SET resource_availability = NULL",
            "UPDATE course_materials SET resource_availability = ''",
            "UPDATE course_materials SET type = 'report'",
            "UPDATE material_resources SET type = 'external', url = NULL",
        ] {
            assert!(
                store
                    .connection
                    .execute_unprepared(statement)
                    .await
                    .is_err(),
                "{statement}"
            );
        }
        for statement in [
            "UPDATE course_materials SET type = 'report', resource_availability = NULL",
            "UPDATE material_resources SET type = 'external'",
            "UPDATE material_resources SET type = 'file', url = NULL",
        ] {
            store
                .connection
                .execute_unprepared(statement)
                .await
                .unwrap();
        }
    }

    #[tokio::test]
    async fn report_constraints_and_all_statuses_round_trip() {
        let store = super::Store::open("sqlite::memory:").await.unwrap();
        let statuses = [
            crate::model::ReportStatus::Unviewed,
            crate::model::ReportStatus::Unsubmitted,
            crate::model::ReportStatus::Submitted,
            crate::model::ReportStatus::ResubmissionRequired,
            crate::model::ReportStatus::Evaluated,
            crate::model::ReportStatus::Unknown,
        ];
        for status in statuses {
            let mut material = material("REP1", "report");
            material.kind = crate::model::MaterialKind::Report { status };
            let report = crate::model::Report {
                prompt_html: Some("<p>report</p>".into()),
                status,
                submission: crate::model::SubmissionPeriod::At(
                    crate::model::SubmissionWindow::new(
                        Some("2026-11-01T00:00:00Z".parse().unwrap()),
                        Some("2026-11-12T00:00:00Z".parse().unwrap()),
                    )
                    .unwrap(),
                ),
                correction: crate::model::Correction::Limited { limit: 3 },
                max_total_file_bytes: Some(1024),
                text_answer_allowed: Some(true),
                file_answer_allowed: Some(false),
                retrieved_at: None,
            };
            store
                .append(crate::model::Snapshot {
                    courses: Some(crate::model::CourseListing {
                        academic_year: 2026.try_into().unwrap(),
                        entries: vec![course("course1")],
                    }),
                    materials: Some(listing(vec![material])),
                    contents: Some(crate::model::MaterialContents {
                        material_id: "REP1".to_owned().try_into().unwrap(),
                        resources: None,
                        report: Some(report),
                    }),
                })
                .await
                .unwrap();
            let detail = store
                .material_detail(&"REP1".to_owned().try_into().unwrap())
                .await
                .unwrap();
            let report = detail.report.unwrap();
            assert_eq!(report.status, status);
            assert!(matches!(
                report.correction,
                crate::model::Correction::Limited { limit: 3 }
            ));
            assert_eq!(report.file_answer_allowed, Some(false));
            assert_eq!(report.max_total_file_bytes, Some(1024));
        }
    }

    #[tokio::test]
    async fn database_paths_preserve_reserved_characters() {
        let temporary = tempfile::tempdir().unwrap();
        let filename = if cfg!(windows) {
            "archive #% 日本語.sqlite"
        } else {
            "archive #?% 日本語.sqlite"
        };
        let path = temporary.path().join(filename);
        let store = super::Store::open_path(&path).await.unwrap();
        store
            .append(snapshot(vec![material("MAT1", "original")], None))
            .await
            .unwrap();
        store.connection.close().await.unwrap();
        assert!(path.is_file());
        assert_eq!(
            super::Store::open_path(&path)
                .await
                .unwrap()
                .courses()
                .await
                .unwrap()
                .len(),
            1
        );
    }

    #[tokio::test]
    async fn current_duplicate_folder_names_are_preserved_without_empty_history_folders() {
        let store = super::Store::open("sqlite::memory:").await.unwrap();
        let mut initial = listing(Vec::new());
        initial.folders[0].name = "removed empty folder".into();
        store
            .append(crate::model::Snapshot {
                courses: Some(crate::model::CourseListing {
                    academic_year: 2026.try_into().unwrap(),
                    entries: vec![course("course1")],
                }),
                materials: Some(initial),
                contents: None,
            })
            .await
            .unwrap();
        let mut current = listing(vec![material("MAT1", "first")]);
        let mut duplicate = current.folders[0].clone();
        duplicate.materials = vec![material("MAT2", "second")];
        current.folders.push(duplicate);
        store
            .append(crate::model::Snapshot {
                courses: None,
                materials: Some(current),
                contents: None,
            })
            .await
            .unwrap();
        let result = store
            .course_materials(&"course1".to_owned().try_into().unwrap())
            .await
            .unwrap();
        assert_eq!(result.folders.len(), 2);
        assert_eq!(result.folders[0].materials[0].name, "first");
        assert_eq!(result.folders[1].materials[0].name, "second");
    }

    async fn entity_matches_schema<E: sea_orm::EntityTrait>(
        connection: &sea_orm::DatabaseConnection,
        entity: E,
    ) {
        let generated = sea_orm::Database::connect("sqlite::memory:").await.unwrap();
        let statement =
            sea_orm::Schema::new(sea_orm::DbBackend::Sqlite).create_table_from_entity(entity);
        generated.execute(&statement).await.unwrap();
        let name = sea_orm::EntityName::table_name(&entity);
        let statement = sea_orm::Statement::from_string(
            sea_orm::DbBackend::Sqlite,
            format!("PRAGMA table_info(\"{name}\")"),
        );
        let columns = connection.query_all_raw(statement.clone()).await.unwrap();
        let expected = generated.query_all_raw(statement).await.unwrap();
        assert_eq!(columns.len(), expected.len(), "{name}");
        for (column, expected) in columns.iter().zip(&expected) {
            assert_eq!(
                column.try_get::<String>("", "name").unwrap(),
                expected.try_get::<String>("", "name").unwrap(),
                "{name}"
            );
            assert_eq!(
                column.try_get::<i64>("", "notnull").unwrap(),
                expected.try_get::<i64>("", "notnull").unwrap(),
                "{name}"
            );
            assert_eq!(
                column.try_get::<i64>("", "pk").unwrap(),
                expected.try_get::<i64>("", "pk").unwrap(),
                "{name}"
            );
        }
    }

    #[tokio::test]
    async fn every_entity_matches_schema_columns_nullability_and_composite_keys() {
        let store = super::Store::open("sqlite::memory:").await.unwrap();
        entity_matches_schema(&store.connection, super::entity::archive_state::Entity).await;
        entity_matches_schema(&store.connection, super::entity::course_retrievals::Entity).await;
        entity_matches_schema(&store.connection, super::entity::courses::Entity).await;
        entity_matches_schema(
            &store.connection,
            super::entity::course_material_retrievals::Entity,
        )
        .await;
        entity_matches_schema(
            &store.connection,
            super::entity::course_material_folders::Entity,
        )
        .await;
        entity_matches_schema(&store.connection, super::entity::course_materials::Entity).await;
        entity_matches_schema(
            &store.connection,
            super::entity::material_resource_retrievals::Entity,
        )
        .await;
        entity_matches_schema(&store.connection, super::entity::material_resources::Entity).await;
        entity_matches_schema(
            &store.connection,
            super::entity::report_detail_retrievals::Entity,
        )
        .await;
        entity_matches_schema(&store.connection, super::entity::report_details::Entity).await;
        entity_matches_schema(&store.connection, super::entity::saved_files::Entity).await;
    }
}
