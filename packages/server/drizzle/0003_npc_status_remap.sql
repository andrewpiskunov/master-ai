UPDATE documents SET status = 'active' WHERE type IN ('npc', 'pc') AND status IN ('alive', 'unknown');
--> statement-breakpoint
UPDATE documents SET status = 'deceased' WHERE type IN ('npc', 'pc') AND status = 'dead';
