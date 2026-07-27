CREATE TABLE `conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`persona_name` text DEFAULT 'default' NOT NULL,
	`created_at` text DEFAULT 'datetime(''now'')' NOT NULL,
	`updated_at` text DEFAULT 'datetime(''now'')' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `pinned_facts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`fact` text NOT NULL,
	`source` text,
	`confidence` real DEFAULT 0.5 NOT NULL,
	`nature` text DEFAULT 'temporal' NOT NULL,
	`freshness` real DEFAULT 0.5 NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT 'datetime(''now'')' NOT NULL,
	`updated_at` text DEFAULT 'datetime(''now'')' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `lore_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`character_name` text NOT NULL,
	`category` text NOT NULL,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`source` text,
	`created_at` text DEFAULT 'datetime(''now'')' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `memories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tier` text NOT NULL,
	`content` text DEFAULT '' NOT NULL,
	`updated_at` text DEFAULT 'datetime(''now'')' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_memories_tier` ON `memories` (`tier`);--> statement-breakpoint
CREATE TABLE `messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`conversation_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text,
	`tool_calls` text,
	`tool_call_id` text,
	`created_at` text DEFAULT 'datetime(''now'')' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_messages_conversation` ON `messages` (`conversation_id`,`id`);--> statement-breakpoint
CREATE TABLE `reminders` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`guild_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`user_id` text NOT NULL,
	`message` text NOT NULL,
	`action_type` text DEFAULT 'remind' NOT NULL,
	`action_config` text DEFAULT '{}' NOT NULL,
	`type` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`due_at` text NOT NULL,
	`recurrence` text,
	`created_at` text DEFAULT 'datetime(''now'')' NOT NULL,
	`updated_at` text DEFAULT 'datetime(''now'')' NOT NULL,
	`completed_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_reminders_due` ON `reminders` (`status`,`due_at`);--> statement-breakpoint
CREATE INDEX `idx_reminders_channel` ON `reminders` (`channel_id`,`status`);--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`title` text NOT NULL,
	`status` text DEFAULT 'backlog' NOT NULL,
	`priority` text DEFAULT 'medium' NOT NULL,
	`category` text DEFAULT 'Other' NOT NULL,
	`notes` text,
	`deadline` text,
	`created_at` text DEFAULT 'datetime(''now'')' NOT NULL,
	`updated_at` text DEFAULT 'datetime(''now'')' NOT NULL,
	`archived` integer DEFAULT 0 NOT NULL,
	`sprint` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_tasks_user_status` ON `tasks` (`user_id`,`status`,`archived`);