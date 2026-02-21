CREATE TABLE `global_contexts` (
	`id` text PRIMARY KEY NOT NULL,
	`category` text NOT NULL,
	`name` text NOT NULL,
	`content` text NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`priority` integer DEFAULT 100 NOT NULL,
	`scope` text DEFAULT 'global' NOT NULL,
	`project_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);

CREATE INDEX `global_contexts_category_idx` ON `global_contexts` (`category`);
CREATE INDEX `global_contexts_enabled_idx` ON `global_contexts` (`enabled`);
CREATE INDEX `global_contexts_project_id_idx` ON `global_contexts` (`project_id`);
CREATE INDEX `global_contexts_priority_idx` ON `global_contexts` (`priority`);
