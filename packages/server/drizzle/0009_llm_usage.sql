CREATE TABLE `llm_usage` (
	`id` text PRIMARY KEY NOT NULL,
	`campaign_id` text NOT NULL,
	`feature` text NOT NULL,
	`model` text,
	`prompt_tokens` integer NOT NULL,
	`completion_tokens` integer NOT NULL,
	`estimated` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `llm_usage_campaign_idx` ON `llm_usage` (`campaign_id`);
