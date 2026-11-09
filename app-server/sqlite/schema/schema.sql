CREATE TABLE IF NOT EXISTS archive_state (
    -- 取得順序を採番する論理時計。端末間で共有しないローカル状態
    singleton INTEGER PRIMARY KEY NOT NULL CHECK (singleton = 1), -- 常に1。DBごとに1行だけ保持する
    clock_millis INTEGER NOT NULL CHECK (clock_millis >= 0), -- 最後に採番した論理時計の時刻部分（Unixミリ秒）。実時計が戻っても減らさない
    clock_counter INTEGER NOT NULL CHECK (clock_counter >= 0) -- 論理時計の同一時刻内の連番。時刻部分を更新したら0に戻す
);
INSERT INTO archive_state(singleton, clock_millis, clock_counter)
VALUES (1, 0, 0) ON CONFLICT(singleton) DO NOTHING;

CREATE TABLE IF NOT EXISTS course_retrievals (
    -- 年度ごとの講義一覧の取得履歴。取得ごとに追記し、過去の一覧を保持する
    id TEXT PRIMARY KEY NOT NULL, -- 種類ごとに独立した、端末間で一意な取得ID（UUID）
    fetched_at INTEGER NOT NULL CHECK (fetched_at >= 0), -- 取得時刻（Unixミリ秒）。表示用の日時
    clock_millis INTEGER NOT NULL CHECK (clock_millis >= fetched_at), -- 論理時計の時刻部分（Unixミリ秒）。取得日時とは別に順序を決める
    clock_counter INTEGER NOT NULL CHECK (clock_counter >= 0), -- 論理時計の同一時刻内の連番。同値の場合は取得IDで順序を決める
    academic_year INTEGER NOT NULL CHECK (academic_year BETWEEN 1 AND 9999) -- 対象の学年度（1〜9999）
);
CREATE INDEX IF NOT EXISTS course_retrievals_year ON course_retrievals(academic_year, clock_millis, clock_counter, id);
CREATE TABLE IF NOT EXISTS courses (
    -- 講義一覧のスナップショット。LMSの講義IDがない行も表示順を含めて保持する
    retrieval_id TEXT NOT NULL REFERENCES course_retrievals(id), -- 講義一覧の取得ID
    position INTEGER NOT NULL, -- 取得した一覧内の表示順（0始まり）
    lms_course_id TEXT, -- LMSの講義ID。IDが取得できない行はNULL
    name TEXT NOT NULL, -- 講義名
    availability TEXT NOT NULL, -- LMSに表示された講義の公開・利用状態
    type TEXT NOT NULL CHECK (type IN ('scheduled', 'other', 'unknown')), -- 時間割区分：scheduled（曜日・時限あり）、other（その他）、unknown（不明）
    weekday INTEGER CHECK (weekday BETWEEN 1 AND 7), -- 曜日（1＝月曜〜7＝日曜）。scheduled以外はNULL
    period INTEGER CHECK (period >= 1), -- 時限（1始まり）。scheduled以外はNULL
    CHECK (
        (type = 'scheduled' AND weekday IS NOT NULL AND period IS NOT NULL)
        OR (type IN ('other', 'unknown') AND weekday IS NULL AND period IS NULL)
    ),
    PRIMARY KEY (retrieval_id, position)
);
CREATE INDEX IF NOT EXISTS courses_course_retrieval ON courses(lms_course_id, retrieval_id);

CREATE TABLE IF NOT EXISTS course_material_retrievals (
    -- 講義ごとの教材一覧の取得履歴。空の一覧を取得した場合も記録する
    id TEXT PRIMARY KEY NOT NULL, -- 種類ごとに独立した、端末間で一意な取得ID（UUID）
    fetched_at INTEGER NOT NULL CHECK (fetched_at >= 0), -- 取得時刻（Unixミリ秒）。表示用の日時
    clock_millis INTEGER NOT NULL CHECK (clock_millis >= fetched_at), -- 論理時計の時刻部分（Unixミリ秒）。取得日時とは別に順序を決める
    clock_counter INTEGER NOT NULL CHECK (clock_counter >= 0), -- 論理時計の同一時刻内の連番。同値の場合は取得IDで順序を決める
    lms_course_id TEXT NOT NULL -- 取得対象のLMS講義ID
);
CREATE INDEX IF NOT EXISTS material_retrievals_course ON course_material_retrievals(lms_course_id, clock_millis, clock_counter, id);
CREATE TABLE IF NOT EXISTS course_material_folders (
    -- 教材一覧の取得時点における教材フォルダー。LMS上では「授業」と表示されるまとまり
    retrieval_id TEXT NOT NULL REFERENCES course_material_retrievals(id), -- 教材一覧の取得ID
    position INTEGER NOT NULL, -- 取得した一覧内のフォルダー表示順（0始まり）
    name TEXT NOT NULL, -- 教材フォルダー名
    class_date TEXT, -- 授業日（YYYY-MM-DD）。未掲載・不正な日付はNULL
    description_html TEXT, -- フォルダーの説明HTML。取得できない場合はNULL
    PRIMARY KEY (retrieval_id, position)
);
CREATE TABLE IF NOT EXISTS course_materials (
    -- 教材一覧のスナップショット。教材の種類・状態・公開期限と所属フォルダーを保持する
    retrieval_id TEXT NOT NULL, -- 教材一覧の取得ID
    position INTEGER NOT NULL, -- 全フォルダーを通した教材の表示順（0始まり）
    folder_position INTEGER NOT NULL, -- 同じ取得内の所属フォルダーの表示順
    lms_material_id TEXT NOT NULL, -- LMSの教材ID。同じ取得内で一意
    name TEXT NOT NULL, -- 教材名
    type TEXT NOT NULL CHECK (type IN ('material', 'report', 'test', 'questionnaire', 'e-learning', 'board', 'feedback', 'unknown')), -- 教材種別：material、report、test、questionnaire、e-learning、board、feedback、unknown
    status TEXT NOT NULL, -- 教材種別に応じた閲覧・提出・受験等の状態。不明な値はunknown。許容値はCHECK制約で定義
    material_link_available INTEGER NOT NULL CHECK (material_link_available IN (0, 1)), -- 教材へのリンクが利用可能か（0＝不可、1＝可）
    publication_deadline_kind TEXT NOT NULL CHECK (publication_deadline_kind IN ('at', 'unlisted', 'closed', 'unknown')), -- 公開期限の区分：at（日時あり）、unlisted（掲載なし）、closed（公開終了）、unknown（不明）
    publication_deadline_at INTEGER, -- 公開期限（Unixミリ秒）。区分がatの場合のみ値を持つ
    resource_availability TEXT NOT NULL, -- LMSに表示された資料の公開・利用状態
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
    -- 教材ごとの資料一覧の取得履歴。未取得と、取得済みの空一覧を区別する
    id TEXT PRIMARY KEY NOT NULL, -- 種類ごとに独立した、端末間で一意な取得ID（UUID）
    fetched_at INTEGER NOT NULL CHECK (fetched_at >= 0), -- 取得時刻（Unixミリ秒）。表示用の日時
    clock_millis INTEGER NOT NULL CHECK (clock_millis >= fetched_at), -- 論理時計の時刻部分（Unixミリ秒）。取得日時とは別に順序を決める
    clock_counter INTEGER NOT NULL CHECK (clock_counter >= 0), -- 論理時計の同一時刻内の連番。同値の場合は取得IDで順序を決める
    lms_material_id TEXT NOT NULL, -- 取得対象のLMS教材ID
    UNIQUE (id, lms_material_id)
);
CREATE INDEX IF NOT EXISTS resource_retrievals_material ON material_resource_retrievals(lms_material_id, clock_millis, clock_counter, id);
CREATE TABLE IF NOT EXISTS material_resources (
    -- 資料一覧のスナップショット。ファイルや外部リンクの情報を取得時点のまま保持する
    retrieval_id TEXT NOT NULL REFERENCES material_resource_retrievals(id), -- 資料一覧の取得ID
    position INTEGER NOT NULL, -- 取得した一覧内の表示順（0始まり）
    lms_resource_id TEXT NOT NULL, -- LMSの資料ID。同じ取得内で一意
    name TEXT NOT NULL, -- 資料名
    type TEXT NOT NULL CHECK (type IN ('file', 'external', 'unknown')), -- 資料種別：file（ファイル）、external（外部リンク）、unknown（不明）
    status TEXT NOT NULL CHECK (status IN ('unviewed', 'viewed', 'unknown')), -- 閲覧状態：unviewed（未閲覧）、viewed（閲覧済み）、unknown（不明）
    registered_on TEXT, -- 登録日（YYYY-MM-DD）。未掲載・不正な日付はNULL
    first_viewed_on TEXT, -- 初回閲覧日（YYYY-MM-DD）。未掲載・不正な日付はNULL
    description TEXT, -- 資料の説明。取得できない場合はNULL
    url TEXT NOT NULL, -- LMSから取得した資料のURL
    PRIMARY KEY (retrieval_id, position),
    UNIQUE (retrieval_id, lms_resource_id)
);
CREATE INDEX IF NOT EXISTS resources_resource_retrieval ON material_resources(lms_resource_id, retrieval_id);
CREATE TABLE IF NOT EXISTS saved_resources (
    -- 教材・資料ごとの現在の保存ファイル。成功時だけ置き換え、公開終了後も保持する
    lms_material_id TEXT NOT NULL, -- LMSの教材ID。資料IDと組み合わせて保存ファイルを識別する
    lms_resource_id TEXT NOT NULL, -- LMSの資料ID
    file_id TEXT NOT NULL UNIQUE, -- ローカル保存ファイルのID。保存ごとに新しいIDを割り当てる
    original_filename TEXT NOT NULL, -- 保存ファイルの元のファイル名
    sha256 TEXT NOT NULL, -- 保存ファイルのSHA-256ハッシュ
    file_size INTEGER NOT NULL CHECK (file_size >= 0), -- 保存ファイルのサイズ（バイト）
    resource_retrieval_id TEXT NOT NULL, -- 保存ファイルに対応する資料一覧の取得ID。教材ID・資料IDの両方との整合性を外部キーで保証する
    PRIMARY KEY (lms_material_id, lms_resource_id),
    FOREIGN KEY (resource_retrieval_id, lms_resource_id) REFERENCES material_resources(retrieval_id, lms_resource_id),
    FOREIGN KEY (resource_retrieval_id, lms_material_id) REFERENCES material_resource_retrievals(id, lms_material_id)
);

CREATE TABLE IF NOT EXISTS report_detail_retrievals (
    -- レポート教材ごとの詳細の取得履歴。取得ごとに追記する
    id TEXT PRIMARY KEY NOT NULL, -- 種類ごとに独立した、端末間で一意な取得ID（UUID）
    fetched_at INTEGER NOT NULL CHECK (fetched_at >= 0), -- 取得時刻（Unixミリ秒）。表示用の日時
    clock_millis INTEGER NOT NULL CHECK (clock_millis >= fetched_at), -- 論理時計の時刻部分（Unixミリ秒）。取得日時とは別に順序を決める
    clock_counter INTEGER NOT NULL CHECK (clock_counter >= 0), -- 論理時計の同一時刻内の連番。同値の場合は取得IDで順序を決める
    lms_material_id TEXT NOT NULL -- 取得対象のLMS教材ID
);
CREATE INDEX IF NOT EXISTS report_retrievals_material ON report_detail_retrievals(lms_material_id, clock_millis, clock_counter, id);
CREATE TABLE IF NOT EXISTS report_details (
    -- レポート詳細のスナップショット。提出期間・修正条件・回答形式を保持する
    retrieval_id TEXT PRIMARY KEY NOT NULL REFERENCES report_detail_retrievals(id), -- レポート詳細の取得ID。1回の取得に1行が対応する
    prompt_html TEXT, -- 課題本文のHTML。取得できない場合はNULL
    status TEXT NOT NULL CHECK (status IN ('unviewed', 'unsubmitted', 'submitted', 'resubmission-required', 'evaluated', 'unknown')), -- 提出状態：unviewed、unsubmitted、submitted、resubmission-required、evaluated、unknown
    submission_period_kind TEXT NOT NULL CHECK (submission_period_kind IN ('at', 'unlisted', 'unknown')), -- 提出期間の区分：at（開始または締切あり）、unlisted（掲載なし）、unknown（不明）
    submission_starts_at INTEGER, -- 提出開始時刻（Unixミリ秒）。開始が不明・未掲載の場合はNULL
    submission_due_at INTEGER, -- 提出締切時刻（Unixミリ秒）。締切が不明・未掲載の場合はNULL
    correction_mode TEXT NOT NULL CHECK (correction_mode IN ('unknown', 'not-allowed', 'unlimited', 'limited')), -- 修正条件：unknown（不明）、not-allowed（不可）、unlimited（無制限）、limited（回数制限）
    correction_limit INTEGER CHECK (correction_limit >= 0), -- 修正回数の上限（0以上）。correction_modeがlimitedの場合のみ値を持つ
    text_answer_allowed INTEGER CHECK (text_answer_allowed IN (0, 1)), -- テキスト回答を許可するか（0＝不可、1＝可、NULL＝不明）
    file_answer_allowed INTEGER CHECK (file_answer_allowed IN (0, 1)), -- ファイル回答を許可するか（0＝不可、1＝可、NULL＝不明）
    max_total_file_bytes INTEGER CHECK (max_total_file_bytes >= 0), -- 提出ファイルの合計サイズ上限（バイト）。不明の場合はNULL
    CHECK (
        (submission_period_kind = 'at' AND (submission_starts_at IS NOT NULL OR submission_due_at IS NOT NULL))
        OR (submission_period_kind IN ('unlisted', 'unknown') AND submission_starts_at IS NULL AND submission_due_at IS NULL)
    ),
    CHECK (submission_starts_at IS NULL OR submission_due_at IS NULL OR submission_due_at >= submission_starts_at),
    CHECK ((correction_mode = 'limited') = (correction_limit IS NOT NULL))
);
