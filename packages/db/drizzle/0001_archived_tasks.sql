CREATE TABLE `archived_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`original_id` text NOT NULL,
	`archived_at` integer NOT NULL,
	`task_data` text NOT NULL,
	`reason` text NOT NULL,
	`project_id` text,
	`user_id` text,
	`status` text,
	`created_at` integer
);
--> statement-breakpoint
CREATE INDEX `archived_tasks_original_id_idx` ON `archived_tasks` (`original_id`);
--> statement-breakpoint
CREATE INDEX `archived_tasks_archived_at_idx` ON `archived_tasks` (`archived_at`);
--> statement-breakpoint
CREATE INDEX `archived_tasks_reason_idx` ON `archived_tasks` (`reason`);
--> statement-breakpoint
CREATE INDEX `archived_tasks_project_id_idx` ON `archived_tasks` (`project_id`);