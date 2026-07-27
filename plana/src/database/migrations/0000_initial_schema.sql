CREATE TABLE "conversations" (
	"id" text PRIMARY KEY NOT NULL,
	"persona_name" text DEFAULT 'default' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pinned_facts" (
	"id" serial PRIMARY KEY NOT NULL,
	"fact" text NOT NULL,
	"source" text,
	"confidence" double precision DEFAULT 0.5 NOT NULL,
	"nature" text DEFAULT 'temporal' NOT NULL,
	"freshness" double precision DEFAULT 0.5 NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ck_facts_nature" CHECK ("pinned_facts"."nature" IN ('persistent','temporal'))
);
--> statement-breakpoint
CREATE TABLE "lore_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"character_name" text NOT NULL,
	"category" text NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"source" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memories" (
	"id" serial PRIMARY KEY NOT NULL,
	"tier" text NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ck_memories_tier" CHECK ("memories"."tier" IN ('lifetime','monthly','weekly','daily'))
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"role" text NOT NULL,
	"content" text,
	"tool_calls" text,
	"tool_call_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ck_messages_role" CHECK ("messages"."role" IN ('user','assistant','tool'))
);
--> statement-breakpoint
CREATE TABLE "reminders" (
	"id" serial PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"user_id" text NOT NULL,
	"message" text NOT NULL,
	"action_type" text DEFAULT 'remind' NOT NULL,
	"action_config" text DEFAULT '{}' NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"due_at" timestamp NOT NULL,
	"recurrence" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	CONSTRAINT "ck_reminders_action_type" CHECK ("reminders"."action_type" IN ('remind','greeting','nudge')),
	CONSTRAINT "ck_reminders_type" CHECK ("reminders"."type" IN ('once','recurring')),
	CONSTRAINT "ck_reminders_status" CHECK ("reminders"."status" IN ('active','completed','cancelled'))
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"title" text NOT NULL,
	"status" text DEFAULT 'backlog' NOT NULL,
	"priority" text DEFAULT 'medium' NOT NULL,
	"category" text DEFAULT 'Other' NOT NULL,
	"notes" text,
	"deadline" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"archived" integer DEFAULT 0 NOT NULL,
	"sprint" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "ck_tasks_status" CHECK ("tasks"."status" IN ('backlog','ready','in-progress','done')),
	CONSTRAINT "ck_tasks_priority" CHECK ("tasks"."priority" IN ('low','medium','high','critical'))
);
--> statement-breakpoint
CREATE INDEX "idx_memories_tier" ON "memories" USING btree ("tier");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_memories_tier" ON "memories" USING btree ("tier");--> statement-breakpoint
CREATE INDEX "idx_messages_conversation" ON "messages" USING btree ("conversation_id","id");--> statement-breakpoint
CREATE INDEX "idx_reminders_due" ON "reminders" USING btree ("status","due_at");--> statement-breakpoint
CREATE INDEX "idx_reminders_channel" ON "reminders" USING btree ("channel_id","status");--> statement-breakpoint
CREATE INDEX "idx_tasks_user_status" ON "tasks" USING btree ("user_id","status","archived");