import { sqliteTable, text } from "drizzle-orm/sqlite-core";

export const campaigns = sqliteTable("campaigns", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  system: text("system"),
  description: text("description"),
  createdAt: text("created_at").notNull(),
});

export const documents = sqliteTable("documents", {
  id: text("id").primaryKey(),
  campaignId: text("campaign_id").notNull(),
  type: text("type").notNull(),
  title: text("title").notNull(),
  status: text("status"),
  // ProseMirror-документ и типозависимые поля храним как JSON-строки
  contentJson: text("content_json").notNull().default("null"),
  fields: text("fields").notNull().default("{}"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});
