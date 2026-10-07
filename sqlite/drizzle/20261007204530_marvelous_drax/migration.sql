CREATE TABLE `resource_states` (
	`lms_material_id` text NOT NULL,
	`lms_resource_id` text NOT NULL,
	`name` text NOT NULL,
	`type` text,
	`source_kind` text,
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
ALTER TABLE `material_resources` ADD `lms_resource_id` text;--> statement-breakpoint
ALTER TABLE `material_resources` ADD `type` text;--> statement-breakpoint
ALTER TABLE `material_resources` ADD `source_kind` text;--> statement-breakpoint
ALTER TABLE `material_resources` ADD `url` text;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_material_resources` (
	`retrieval_id` integer NOT NULL,
	`position` integer NOT NULL,
	`name` text NOT NULL,
	`lms_resource_id` text,
	`type` text,
	`source_kind` text,
	`url` text,
	CONSTRAINT `material_resources_pk` PRIMARY KEY(`retrieval_id`, `position`),
	CONSTRAINT `fk_material_resources_retrieval_id_material_resource_retrievals_id_fk` FOREIGN KEY (`retrieval_id`) REFERENCES `material_resource_retrievals`(`id`) ON DELETE CASCADE,
	CONSTRAINT `material_resources_retrieval_resource_id_unique` UNIQUE(`retrieval_id`,`lms_resource_id`)
);
--> statement-breakpoint
INSERT INTO `__new_material_resources`(`retrieval_id`, `position`, `name`) SELECT `retrieval_id`, `position`, `name` FROM `material_resources`;--> statement-breakpoint
DROP TABLE `material_resources`;--> statement-breakpoint
ALTER TABLE `__new_material_resources` RENAME TO `material_resources`;--> statement-breakpoint
PRAGMA foreign_keys=ON;