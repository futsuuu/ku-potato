PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_material_resource_retrievals` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`lms_material_id` text NOT NULL,
	`fetched_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_material_resource_retrievals`(`id`, `lms_material_id`, `fetched_at`)
SELECT `material_resource_retrievals`.`id`, `course_materials`.`lms_material_id`, `material_resource_retrievals`.`fetched_at`
FROM `material_resource_retrievals`
INNER JOIN `course_materials`
    ON `course_materials`.`retrieval_id` = `material_resource_retrievals`.`course_material_retrieval_id`
    AND `course_materials`.`position` = `material_resource_retrievals`.`course_material_position`;--> statement-breakpoint
DROP TABLE `material_resource_retrievals`;--> statement-breakpoint
ALTER TABLE `__new_material_resource_retrievals` RENAME TO `material_resource_retrievals`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `material_resource_retrievals_material_fetched_at_index` ON `material_resource_retrievals` (`lms_material_id`,`fetched_at`);
