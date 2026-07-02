ALTER TABLE `campaigns` ADD `llm_provider` text DEFAULT 'cli' NOT NULL;--> statement-breakpoint
ALTER TABLE `campaigns` ADD `llm_settings` text DEFAULT '{}' NOT NULL;
