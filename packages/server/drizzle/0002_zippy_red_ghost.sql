CREATE TABLE `links` (
	`id` text PRIMARY KEY NOT NULL,
	`campaign_id` text NOT NULL,
	`from_doc_id` text NOT NULL,
	`to_doc_id` text NOT NULL,
	`kind` text NOT NULL
);
--> statement-breakpoint
CREATE VIRTUAL TABLE `documents_fts` USING fts5(
  doc_id UNINDEXED,
  campaign_id UNINDEXED,
  type UNINDEXED,
  title,
  body,
  tokenize = 'unicode61 remove_diacritics 2'
);
