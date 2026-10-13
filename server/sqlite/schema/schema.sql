CREATE TABLE IF NOT EXISTS course_retrievals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fetched_at INTEGER NOT NULL,
    academic_year INTEGER NOT NULL CHECK (academic_year BETWEEN 1 AND 9999)
);
CREATE INDEX IF NOT EXISTS course_retrievals_year ON course_retrievals(academic_year, id);
CREATE TABLE IF NOT EXISTS courses (
    retrieval_id INTEGER NOT NULL REFERENCES course_retrievals(id),
    position INTEGER NOT NULL,
    lms_course_id TEXT,
    name TEXT NOT NULL,
    availability TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('scheduled', 'other', 'unknown')),
    weekday INTEGER CHECK (weekday BETWEEN 1 AND 7),
    period INTEGER CHECK (period >= 1),
    CHECK (
        (type = 'scheduled' AND weekday IS NOT NULL AND period IS NOT NULL)
        OR (type IN ('other', 'unknown') AND weekday IS NULL AND period IS NULL)
    ),
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
    class_date TEXT,
    description_html TEXT,
    PRIMARY KEY (retrieval_id, position)
);
CREATE TABLE IF NOT EXISTS course_materials (
    retrieval_id INTEGER NOT NULL,
    position INTEGER NOT NULL,
    folder_position INTEGER NOT NULL,
    lms_material_id TEXT NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('material', 'report', 'test', 'questionnaire', 'e-learning', 'board', 'feedback', 'unknown')),
    status TEXT NOT NULL,
    material_link_available INTEGER NOT NULL CHECK (material_link_available IN (0, 1)),
    publication_deadline_kind TEXT NOT NULL CHECK (publication_deadline_kind IN ('at', 'unlisted', 'closed', 'unknown')),
    publication_deadline_at INTEGER,
    resource_availability TEXT NOT NULL,
    CHECK ((publication_deadline_kind = 'at') = (publication_deadline_at IS NOT NULL)),
    CHECK (
        status = 'unknown'
        OR (type = 'material' AND status IN ('unviewed', 'viewed', 'partially-viewed'))
        OR (type = 'report' AND status IN ('unviewed', 'unsubmitted', 'submitted', 'resubmission-required', 'evaluated'))
        OR (type IN ('test', 'e-learning') AND status IN ('not-started', 'in-progress', 'completed'))
        OR (type = 'questionnaire' AND status IN ('unanswered', 'answered'))
        OR (type = 'board' AND status IN ('unposted', 'evaluated'))
        OR (type = 'feedback' AND status IN ('unevaluated', 'evaluated'))
    ),
    PRIMARY KEY (retrieval_id, position),
    UNIQUE (retrieval_id, lms_material_id),
    FOREIGN KEY (retrieval_id, folder_position) REFERENCES course_material_folders(retrieval_id, position)
);
CREATE INDEX IF NOT EXISTS materials_material_retrieval ON course_materials(lms_material_id, retrieval_id);

CREATE TABLE IF NOT EXISTS material_resource_retrievals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lms_material_id TEXT NOT NULL,
    fetched_at INTEGER NOT NULL,
    UNIQUE (id, lms_material_id)
);
CREATE INDEX IF NOT EXISTS resource_retrievals_material ON material_resource_retrievals(lms_material_id, id);
CREATE TABLE IF NOT EXISTS material_resources (
    retrieval_id INTEGER NOT NULL REFERENCES material_resource_retrievals(id),
    position INTEGER NOT NULL,
    lms_resource_id TEXT NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('file', 'external', 'unknown')),
    status TEXT NOT NULL CHECK (status IN ('unviewed', 'viewed', 'unknown')),
    registered_on TEXT,
    first_viewed_on TEXT,
    description TEXT,
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
    saved_resource_retrieval_id INTEGER,
    last_succeeded_at INTEGER,
    last_attempt_at INTEGER,
    last_attempt_status TEXT,
    last_attempt_error TEXT,
    PRIMARY KEY (lms_material_id, lms_resource_id),
    FOREIGN KEY (saved_resource_retrieval_id, lms_resource_id) REFERENCES material_resources(retrieval_id, lms_resource_id),
    FOREIGN KEY (saved_resource_retrieval_id, lms_material_id) REFERENCES material_resource_retrievals(id, lms_material_id),
    CHECK (
        (file_id IS NULL AND original_filename IS NULL AND sha256 IS NULL AND file_size IS NULL)
        OR (file_id IS NOT NULL AND original_filename IS NOT NULL AND sha256 IS NOT NULL AND file_size IS NOT NULL)
    ),
    CHECK ((file_id IS NOT NULL) = (saved_resource_retrieval_id IS NOT NULL)),
    CHECK ((last_attempt_at IS NULL) = (last_attempt_status IS NULL)),
    CHECK (last_attempt_status IS NULL OR last_attempt_status IN ('success', 'failure'))
);

CREATE TABLE IF NOT EXISTS report_detail_retrievals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lms_material_id TEXT NOT NULL,
    fetched_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS report_retrievals_material ON report_detail_retrievals(lms_material_id, id);
CREATE TABLE IF NOT EXISTS report_details (
    retrieval_id INTEGER PRIMARY KEY REFERENCES report_detail_retrievals(id),
    prompt_html TEXT,
    status TEXT NOT NULL CHECK (status IN ('unviewed', 'unsubmitted', 'submitted', 'resubmission-required', 'evaluated', 'unknown')),
    submission_period_kind TEXT NOT NULL CHECK (submission_period_kind IN ('at', 'unlisted', 'unknown')),
    submission_starts_at INTEGER,
    submission_due_at INTEGER,
    correction_mode TEXT NOT NULL CHECK (correction_mode IN ('unknown', 'not-allowed', 'unlimited', 'limited')),
    correction_limit INTEGER CHECK (correction_limit >= 0),
    text_answer_allowed INTEGER CHECK (text_answer_allowed IN (0, 1)),
    file_answer_allowed INTEGER CHECK (file_answer_allowed IN (0, 1)),
    max_total_file_bytes INTEGER CHECK (max_total_file_bytes >= 0),
    CHECK (
        (submission_period_kind = 'at' AND (submission_starts_at IS NOT NULL OR submission_due_at IS NOT NULL))
        OR (submission_period_kind IN ('unlisted', 'unknown') AND submission_starts_at IS NULL AND submission_due_at IS NULL)
    ),
    CHECK (submission_starts_at IS NULL OR submission_due_at IS NULL OR submission_due_at >= submission_starts_at),
    CHECK ((correction_mode = 'limited') = (correction_limit IS NOT NULL))
);
