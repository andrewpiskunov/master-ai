import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type { Campaign, NewCampaign } from "@master-ai/shared";
import { campaigns } from "../db/schema.js";

export class CampaignService {
  constructor(private db: BetterSQLite3Database) {}

  create(input: NewCampaign): Campaign {
    const row: Campaign = {
      id: randomUUID(),
      name: input.name,
      system: input.system ?? null,
      description: input.description ?? null,
      createdAt: new Date().toISOString(),
    };
    this.db.insert(campaigns).values(row).run();
    return row;
  }

  list(): Campaign[] {
    return this.db.select().from(campaigns).all();
  }

  get(id: string): Campaign | undefined {
    return this.db.select().from(campaigns).where(eq(campaigns.id, id)).get();
  }
}
