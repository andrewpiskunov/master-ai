import { sqliteTable, text } from "drizzle-orm/sqlite-core";

export const campaigns = sqliteTable("campaigns", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  system: text("system"),
  description: text("description"),
  realism: text("realism").notNull().default("balanced"),
  // Нейросеть кампании: 'cli' (Claude Code) или 'openai'; настройки — JSON (ключ, модель, baseUrl).
  llmProvider: text("llm_provider").notNull().default("cli"),
  llmSettings: text("llm_settings").notNull().default("{}"),
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

export const conversations = sqliteTable("conversations", {
  id: text("id").primaryKey(),
  campaignId: text("campaign_id").notNull(),
  // null — беседа Мастерской (на всю кампанию); иначе — чат ассистента по документу
  documentId: text("document_id"),
  createdAt: text("created_at").notNull(),
});

export const messages = sqliteTable("messages", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id").notNull(),
  role: text("role").notNull(),
  content: text("content").notNull(),
  // Метаданные игрового чата: актор действия / запись лога событий (JSON).
  meta: text("meta").notNull().default("{}"),
  createdAt: text("created_at").notNull(),
});

export const proposals = sqliteTable("proposals", {
  id: text("id").primaryKey(),
  campaignId: text("campaign_id").notNull(),
  conversationId: text("conversation_id").notNull(),
  type: text("type").notNull(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  fields: text("fields").notNull().default("{}"),
  action: text("action").notNull().default("create"),
  status: text("status").notNull().default("pending"),
  createdAt: text("created_at").notNull(),
});

export const links = sqliteTable("links", {
  id: text("id").primaryKey(),
  campaignId: text("campaign_id").notNull(),
  fromDocId: text("from_doc_id").notNull(),
  toDocId: text("to_doc_id").notNull(),
  kind: text("kind").notNull(),
});
