CREATE TABLE `image_thumbnails` (
  `image_id` text NOT NULL,
  `size` integer NOT NULL,
  `version` text NOT NULL,
  `data` blob NOT NULL,
  `etag` text NOT NULL,
  PRIMARY KEY (`image_id`, `size`, `version`)
);
--> statement-breakpoint
CREATE TRIGGER `images_delete_thumbnails` AFTER DELETE ON `images`
BEGIN
  DELETE FROM `image_thumbnails` WHERE `image_id` = OLD.`id`;
END;
