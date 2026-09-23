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
	`fetched_at` integer NOT NULL,
	CONSTRAINT `course_material_retrievals_course_fk` FOREIGN KEY (`course_retrieval_id`,`course_position`) REFERENCES `courses`(`retrieval_id`,`position`) ON DELETE CASCADE
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
	CONSTRAINT `fk_courses_retrieval_id_course_retrievals_id_fk` FOREIGN KEY (`retrieval_id`) REFERENCES `course_retrievals`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `material_resource_retrievals` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`course_material_retrieval_id` integer NOT NULL,
	`course_material_position` integer NOT NULL,
	`fetched_at` integer NOT NULL,
	CONSTRAINT `material_resource_retrievals_course_material_fk` FOREIGN KEY (`course_material_retrieval_id`,`course_material_position`) REFERENCES `course_materials`(`retrieval_id`,`position`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `material_resources` (
	`retrieval_id` integer NOT NULL,
	`position` integer NOT NULL,
	`name` text NOT NULL,
	CONSTRAINT `material_resources_pk` PRIMARY KEY(`retrieval_id`, `position`),
	CONSTRAINT `fk_material_resources_retrieval_id_material_resource_retrievals_id_fk` FOREIGN KEY (`retrieval_id`) REFERENCES `material_resource_retrievals`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `course_material_retrievals_course_fetched_at_index` ON `course_material_retrievals` (`course_retrieval_id`,`course_position`,`fetched_at`);--> statement-breakpoint
CREATE INDEX `courses_lms_course_id_index` ON `courses` (`lms_course_id`);--> statement-breakpoint
CREATE INDEX `material_resource_retrievals_material_fetched_at_index` ON `material_resource_retrievals` (`course_material_retrieval_id`,`course_material_position`,`fetched_at`);