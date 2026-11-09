ALTER TABLE `campaigns` ADD `updated_at` text NOT NULL DEFAULT '';
--> statement-breakpoint
UPDATE `campaigns` SET `updated_at` = `created_at`;
--> statement-breakpoint
ALTER TABLE `campaigns` ADD `cover_image_id` text;
