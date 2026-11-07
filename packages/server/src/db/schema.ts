import { blob, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

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
  updatedAt: text("updated_at").notNull().default(""),
  coverImageId: text("cover_image_id"),
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

export const images = sqliteTable("images", {
  id: text("id").primaryKey(),
  campaignId: text("campaign_id").notNull(),
  name: text("name").notNull(),
  mimeType: text("mime_type").notNull(),
  dataUrl: text("data_url").notNull(),
  createdAt: text("created_at").notNull(),
});

// Производные можно удалить и построить заново; в перенос кампании они не входят.
export const imageThumbnails = sqliteTable("image_thumbnails", {
  imageId: text("image_id").notNull(),
  size: integer("size").notNull(),
  version: text("version").notNull(),
  data: blob("data", { mode: "buffer" }).notNull(),
  etag: text("etag").notNull(),
}, (table) => ({ pk: primaryKey({ columns: [table.imageId, table.size, table.version] }) }));

export const documentImages = sqliteTable("document_images", {
  documentId: text("document_id").notNull(),
  imageId: text("image_id").notNull(),
}, (table) => ({ pk: primaryKey({ columns: [table.documentId, table.imageId] }) }));

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

// Расход токенов запросов к нейросети — по кампании и фиче (мастерская, игровой чат…).
export const llmUsage = sqliteTable("llm_usage", {
  id: text("id").primaryKey(),
  campaignId: text("campaign_id").notNull(),
  feature: text("feature").notNull(),
  model: text("model"),
  promptTokens: integer("prompt_tokens").notNull(),
  completionTokens: integer("completion_tokens").notNull(),
  // 1 — цифры оценочные (провайдер не отдал usage, посчитали по длине текста).
  estimated: integer("estimated").notNull().default(0),
  // Способ запроса ('cli' | 'openai') и длительность ответа в миллисекундах.
  provider: text("provider"),
  durationMs: integer("duration_ms"),
  createdAt: text("created_at").notNull(),
});
