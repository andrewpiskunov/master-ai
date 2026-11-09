CREATE TABLE `images` (
  `id` text PRIMARY KEY NOT NULL,
  `campaign_id` text NOT NULL,
  `name` text NOT NULL,
  `mime_type` text NOT NULL,
  `data_url` text NOT NULL,
  `created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `images_campaign_id_idx` ON `images` (`campaign_id`);
--> statement-breakpoint
CREATE TABLE `document_images` (
  `document_id` text NOT NULL,
  `image_id` text NOT NULL,
  PRIMARY KEY (`document_id`, `image_id`)
);
--> statement-breakpoint
CREATE INDEX `document_images_image_id_idx` ON `document_images` (`image_id`);
