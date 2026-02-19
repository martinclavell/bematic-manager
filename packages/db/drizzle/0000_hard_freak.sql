CREATE TABLE `audit_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`action` text NOT NULL,
	`user_id` text,
	`resource_type` text NOT NULL,
	`resource_id` text,
	`metadata` text DEFAULT '{}' NOT NULL,
	`timestamp` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `offline_queue` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`agent_id` text NOT NULL,
	`message_type` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`delivered` integer DEFAULT false NOT NULL,
	`delivered_at` text
);
--> statement-breakpoint
CREATE INDEX `offline_queue_agent_delivered_idx` ON `offline_queue` (`agent_id`,`delivered`);--> statement-breakpoint
CREATE INDEX `offline_queue_expires_at_idx` ON `offline_queue` (`expires_at`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slack_channel_id` text NOT NULL,
	`local_path` text NOT NULL,
	`agent_id` text NOT NULL,
	`default_model` text DEFAULT 'claude-sonnet-4-5-20250929' NOT NULL,
	`default_max_budget` real DEFAULT 5 NOT NULL,
	`railway_project_id` text,
	`railway_service_id` text,
	`railway_environment_id` text,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `projects_slack_channel_id_unique` ON `projects` (`slack_channel_id`);--> statement-breakpoint
CREATE TABLE `prompt_history` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`prompt` text NOT NULL,
	`category` text,
	`tags` text DEFAULT '[]' NOT NULL,
	`context` text,
	`related_files` text DEFAULT '[]' NOT NULL,
	`execution_status` text DEFAULT 'pending' NOT NULL,
	`execution_notes` text,
	`estimated_duration_minutes` integer,
	`actual_duration_minutes` integer,
	`timestamp` text NOT NULL,
	`completed_at` text
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`model` text NOT NULL,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`estimated_cost` real DEFAULT 0 NOT NULL,
	`duration_ms` integer,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`bot_name` text NOT NULL,
	`command` text NOT NULL,
	`prompt` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`result` text,
	`error_message` text,
	`slack_channel_id` text NOT NULL,
	`slack_thread_ts` text,
	`slack_user_id` text NOT NULL,
	`slack_message_ts` text,
	`session_id` text,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`estimated_cost` real DEFAULT 0 NOT NULL,
	`max_budget` real DEFAULT 5 NOT NULL,
	`parent_task_id` text,
	`files_changed` text DEFAULT '[]' NOT NULL,
	`commands_run` text DEFAULT '[]' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `tasks_status_idx` ON `tasks` (`status`);--> statement-breakpoint
CREATE INDEX `tasks_project_id_idx` ON `tasks` (`project_id`);--> statement-breakpoint
CREATE INDEX `tasks_thread_idx` ON `tasks` (`slack_channel_id`,`slack_thread_ts`);--> statement-breakpoint
CREATE INDEX `tasks_parent_task_id_idx` ON `tasks` (`parent_task_id`);--> statement-breakpoint
CREATE INDEX `tasks_created_at_idx` ON `tasks` (`created_at`);--> statement-breakpoint
CREATE TABLE `user_project_permissions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`project_id` text NOT NULL,
	`permissions` text DEFAULT '[]' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`slack_user_id` text NOT NULL,
	`slack_username` text NOT NULL,
	`role` text DEFAULT 'developer' NOT NULL,
	`rate_limit_override` integer,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_slack_user_id_unique` ON `users` (`slack_user_id`);