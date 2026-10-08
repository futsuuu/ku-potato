CREATE TABLE `course_material_folders` (
	`retrieval_id` integer NOT NULL,
	`position` integer NOT NULL,
	`name` text NOT NULL,
	`class_date` integer,
	CONSTRAINT `course_material_folders_pk` PRIMARY KEY(`retrieval_id`, `position`),
	CONSTRAINT `fk_course_material_folders_retrieval_id_course_material_retrievals_id_fk` FOREIGN KEY (`retrieval_id`) REFERENCES `course_material_retrievals`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `course_material_retrievals` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`course_retrieval_id` integer NOT NULL,
	`course_position` integer NOT NULL,
	`lms_course_id` text NOT NULL,
	`fetched_at` integer NOT NULL,
	CONSTRAINT `course_material_retrievals_course_fk` FOREIGN KEY (`course_retrieval_id`,`course_position`,`lms_course_id`) REFERENCES `courses`(`retrieval_id`,`position`,`lms_course_id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `course_materials` (
	`retrieval_id` integer NOT NULL,
	`position` integer NOT NULL,
	`lms_material_id` text NOT NULL,
	`folder_position` integer NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`publication_deadline_status` text NOT NULL,
	`publication_deadline_at` integer,
	`resource_availability` text,
	CONSTRAINT `course_materials_pk` PRIMARY KEY(`retrieval_id`, `position`),
	CONSTRAINT `fk_course_materials_retrieval_id_course_material_retrievals_id_fk` FOREIGN KEY (`retrieval_id`) REFERENCES `course_material_retrievals`(`id`) ON DELETE CASCADE,
	CONSTRAINT `course_materials_folder_fk` FOREIGN KEY (`retrieval_id`,`folder_position`) REFERENCES `course_material_folders`(`retrieval_id`,`position`),
	CONSTRAINT `course_materials_retrieval_material_id_unique` UNIQUE(`retrieval_id`,`lms_material_id`)
);
--> statement-breakpoint
CREATE TABLE `course_retrievals` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`fetched_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `courses` (
	`retrieval_id` integer NOT NULL,
	`position` integer NOT NULL,
	`lms_course_id` text,
	`name` text NOT NULL,
	`availability` text NOT NULL,
	CONSTRAINT `courses_pk` PRIMARY KEY(`retrieval_id`, `position`),
	CONSTRAINT `fk_courses_retrieval_id_course_retrievals_id_fk` FOREIGN KEY (`retrieval_id`) REFERENCES `course_retrievals`(`id`) ON DELETE CASCADE,
	CONSTRAINT `courses_retrieval_position_course_id_unique` UNIQUE(`retrieval_id`,`position`,`lms_course_id`)
);
--> statement-breakpoint
CREATE TABLE `material_resource_retrievals` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`lms_material_id` text NOT NULL,
	`fetched_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `material_resources` (
	`retrieval_id` integer NOT NULL,
	`position` integer NOT NULL,
	`name` text NOT NULL,
	`lms_resource_id` text NOT NULL,
	`type` text NOT NULL,
	`source_kind` text NOT NULL,
	`url` text,
	CONSTRAINT `material_resources_pk` PRIMARY KEY(`retrieval_id`, `position`),
	CONSTRAINT `fk_material_resources_retrieval_id_material_resource_retrievals_id_fk` FOREIGN KEY (`retrieval_id`) REFERENCES `material_resource_retrievals`(`id`) ON DELETE CASCADE,
	CONSTRAINT `material_resources_retrieval_resource_id_unique` UNIQUE(`retrieval_id`,`lms_resource_id`)
);
--> statement-breakpoint
CREATE TABLE `resource_states` (
	`lms_material_id` text NOT NULL,
	`lms_resource_id` text NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`source_kind` text NOT NULL,
	`url` text,
	`is_current` integer NOT NULL,
	`file_uuid` text,
	`original_filename` text,
	`sha256` text,
	`file_size` integer,
	`file_source_url` text,
	`last_succeeded_at` integer,
	`last_attempt_at` integer,
	`last_attempt_status` text,
	`last_attempt_error` text,
	CONSTRAINT `resource_states_pk` PRIMARY KEY(`lms_material_id`, `lms_resource_id`)
);
--> statement-breakpoint
CREATE INDEX `course_material_retrievals_course_fetched_at_index` ON `course_material_retrievals` (`course_retrieval_id`,`course_position`,`fetched_at`);--> statement-breakpoint
CREATE INDEX `course_materials_material_retrieval_index` ON `course_materials` (`lms_material_id`,`retrieval_id`);--> statement-breakpoint
CREATE INDEX `courses_lms_course_id_index` ON `courses` (`lms_course_id`);--> statement-breakpoint
CREATE INDEX `material_resource_retrievals_material_fetched_at_index` ON `material_resource_retrievals` (`lms_material_id`,`fetched_at`);