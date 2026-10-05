CREATE TABLE `__new_courses` (
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
INSERT INTO `__new_courses` SELECT `retrieval_id`, `position`, `lms_course_id`, `name`, `availability` FROM `courses`;
--> statement-breakpoint
CREATE TABLE `__new_course_material_retrievals` (
    `id` integer PRIMARY KEY AUTOINCREMENT,
    `course_retrieval_id` integer NOT NULL,
    `course_position` integer NOT NULL,
    `lms_course_id` text NOT NULL,
    `fetched_at` integer NOT NULL,
    CONSTRAINT `course_material_retrievals_course_fk` FOREIGN KEY (`course_retrieval_id`,`course_position`,`lms_course_id`) REFERENCES `courses`(`retrieval_id`,`position`,`lms_course_id`) ON DELETE CASCADE,
    CONSTRAINT `course_material_retrievals_id_course_id_unique` UNIQUE(`id`,`lms_course_id`)
);
--> statement-breakpoint
INSERT INTO `__new_course_material_retrievals` (`id`, `course_retrieval_id`, `course_position`, `lms_course_id`, `fetched_at`)
SELECT r.`id`, r.`course_retrieval_id`, r.`course_position`, c.`lms_course_id`, r.`fetched_at`
FROM `course_material_retrievals` r
JOIN `courses` c ON c.`retrieval_id` = r.`course_retrieval_id` AND c.`position` = r.`course_position`;
--> statement-breakpoint
CREATE TABLE `__new_course_materials` (
    `retrieval_id` integer NOT NULL,
    `position` integer NOT NULL,
    `lms_material_id` text NOT NULL,
    `lms_course_id` text NOT NULL,
    `folder_position` integer NOT NULL,
    `name` text NOT NULL,
    `type` text NOT NULL,
    `publication_deadline_status` text NOT NULL,
    `publication_deadline_at` integer,
    `resource_availability` text,
    CONSTRAINT `course_materials_pk` PRIMARY KEY(`retrieval_id`, `position`),
    CONSTRAINT `course_materials_course_fk` FOREIGN KEY (`retrieval_id`,`lms_course_id`) REFERENCES `course_material_retrievals`(`id`,`lms_course_id`) ON DELETE CASCADE,
    CONSTRAINT `course_materials_folder_fk` FOREIGN KEY (`retrieval_id`,`folder_position`) REFERENCES `course_material_folders`(`retrieval_id`,`position`),
    CONSTRAINT `course_materials_retrieval_material_id_unique` UNIQUE(`retrieval_id`,`lms_material_id`)
);
--> statement-breakpoint
INSERT INTO `__new_course_materials` (`retrieval_id`, `position`, `lms_material_id`, `lms_course_id`, `folder_position`, `name`, `type`, `publication_deadline_status`, `publication_deadline_at`, `resource_availability`)
SELECT m.`retrieval_id`, m.`position`, m.`lms_material_id`, r.`lms_course_id`, m.`folder_position`, m.`name`, m.`type`, m.`publication_deadline_status`, m.`publication_deadline_at`, m.`resource_availability`
FROM `course_materials` m
JOIN `__new_course_material_retrievals` r ON r.`id` = m.`retrieval_id`;
--> statement-breakpoint
DROP TABLE `course_materials`;
--> statement-breakpoint
DROP TABLE `course_material_retrievals`;
--> statement-breakpoint
DROP TABLE `courses`;
--> statement-breakpoint
ALTER TABLE `__new_courses` RENAME TO `courses`;
--> statement-breakpoint
ALTER TABLE `__new_course_material_retrievals` RENAME TO `course_material_retrievals`;
--> statement-breakpoint
ALTER TABLE `__new_course_materials` RENAME TO `course_materials`;
--> statement-breakpoint
CREATE INDEX `courses_lms_course_id_index` ON `courses` (`lms_course_id`);
--> statement-breakpoint
CREATE INDEX `course_material_retrievals_course_fetched_at_index` ON `course_material_retrievals` (`course_retrieval_id`,`course_position`,`fetched_at`);
--> statement-breakpoint
CREATE INDEX `course_materials_material_retrieval_index` ON `course_materials` (`lms_material_id`,`retrieval_id`);
