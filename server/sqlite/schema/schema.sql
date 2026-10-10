CREATE TABLE IF NOT EXISTS course_retrievals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fetched_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS courses (
    retrieval_id INTEGER NOT NULL REFERENCES course_retrievals(id),
    position INTEGER NOT NULL,
    lms_course_id TEXT,
    name TEXT NOT NULL,
    availability TEXT NOT NULL,
    PRIMARY KEY (retrieval_id, position)
);
CREATE INDEX IF NOT EXISTS courses_course_retrieval ON courses(lms_course_id, retrieval_id);

CREATE TABLE IF NOT EXISTS course_material_retrievals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lms_course_id TEXT NOT NULL,
    fetched_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS material_retrievals_course ON course_material_retrievals(lms_course_id, id);
CREATE TABLE IF NOT EXISTS course_material_folders (
    retrieval_id INTEGER NOT NULL REFERENCES course_material_retrievals(id),
    position INTEGER NOT NULL,
    name TEXT NOT NULL,
    class_date TEXT NOT NULL,
    PRIMARY KEY (retrieval_id, position)
);
CREATE TABLE IF NOT EXISTS course_materials (
    retrieval_id INTEGER NOT NULL,
    position INTEGER NOT NULL,
    folder_position INTEGER NOT NULL,
    lms_material_id TEXT NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    publication_deadline TEXT NOT NULL,
    resource_availability TEXT NOT NULL,
    PRIMARY KEY (retrieval_id, position),
    UNIQUE (retrieval_id, lms_material_id),
    FOREIGN KEY (retrieval_id, folder_position) REFERENCES course_material_folders(retrieval_id, position)
);
CREATE INDEX IF NOT EXISTS materials_material_retrieval ON course_materials(lms_material_id, retrieval_id);

CREATE TABLE IF NOT EXISTS material_resource_retrievals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lms_material_id TEXT NOT NULL,
    fetched_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS resource_retrievals_material ON material_resource_retrievals(lms_material_id, id);
CREATE TABLE IF NOT EXISTS material_resources (
    retrieval_id INTEGER NOT NULL REFERENCES material_resource_retrievals(id),
    position INTEGER NOT NULL,
    lms_resource_id TEXT NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    source_kind TEXT NOT NULL,
    url TEXT NOT NULL,
    PRIMARY KEY (retrieval_id, position),
    UNIQUE (retrieval_id, lms_resource_id)
);
CREATE INDEX IF NOT EXISTS resources_resource_retrieval ON material_resources(lms_resource_id, retrieval_id);
CREATE TABLE IF NOT EXISTS resource_states (
    lms_material_id TEXT NOT NULL,
    lms_resource_id TEXT NOT NULL,
    file_id TEXT,
    original_filename TEXT,
    sha256 TEXT,
    file_size INTEGER,
    last_succeeded_at INTEGER,
    last_attempt_at INTEGER,
    last_attempt_status TEXT,
    last_attempt_error TEXT,
    PRIMARY KEY (lms_material_id, lms_resource_id),
    CHECK (
        (file_id IS NULL AND original_filename IS NULL AND sha256 IS NULL AND file_size IS NULL)
        OR (file_id IS NOT NULL AND original_filename IS NOT NULL AND sha256 IS NOT NULL AND file_size IS NOT NULL)
    ),
    CHECK ((last_attempt_at IS NULL) = (last_attempt_status IS NULL)),
    CHECK (last_attempt_status IS NULL OR last_attempt_status IN ('success', 'failure'))
);

CREATE TABLE IF NOT EXISTS authentication_state (
    id INTEGER NOT NULL PRIMARY KEY CHECK (id = 1),
    status TEXT NOT NULL CHECK (status IN ('unknown', 'authenticated', 'unauthenticated')),
    checked_at INTEGER NOT NULL
);
