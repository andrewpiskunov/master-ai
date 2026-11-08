import type {
  Campaign,
  NewCampaign,
  CampaignPatch,
  Document,
  NewDocument,
  DocumentTypeDef,
  Proposal,
  BrainstormResponse,
  ConversationMessage,
  SearchHit,
  Link,
  NewLink,
  DocumentLinks,
  ConsistencyResult,
  MessageMeta,
  GameLogEntry,
  LlmUsageStats,
  GlobalLlmUsageStats,
  LlmRuntimeConfig,
  ImageAttachment,
} from "@master-ai/shared";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  // content-type ставим только когда есть тело: Fastify отвергает пустое
  // тело с content-type: application/json ошибкой 400 (например, approve/reject).
  const headers = init?.body != null
    ? { "content-type": "application/json", ...init?.headers }
    : init?.headers;
  const res = await fetch(path, { ...init, headers });
  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // тело не JSON — оставляем statusText
    }
    throw new ApiError(res.status, message);
  }
  return (await res.json()) as T;
}

type DocumentPatch = Partial<Pick<Document, "type" | "title" | "status" | "contentJson" | "fields">>;

export const api = {
  llmConfig: () => request<LlmRuntimeConfig>("/api/llm/config"),
  listDocumentTypes: () => request<DocumentTypeDef[]>("/api/document-types"),
  listCampaigns: () => request<Campaign[]>("/api/campaigns"),
  createCampaign: (input: NewCampaign) =>
    request<Campaign>("/api/campaigns", { method: "POST", body: JSON.stringify(input) }),
  getCampaign: (id: string) => request<Campaign>(`/api/campaigns/${id}`),
  updateCampaign: (id: string, patch: CampaignPatch) =>
    request<Campaign>(`/api/campaigns/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteCampaign: (id: string) =>
    fetch(`/api/campaigns/${id}`, { method: "DELETE" }).then((res) => {
      if (!res.ok) throw new ApiError(res.status, res.statusText);
    }),
  listCampaignDocuments: (campaignId: string) =>
    request<Document[]>(`/api/campaigns/${campaignId}/documents`),
  createDocument: (input: NewDocument) =>
    request<Document>("/api/documents", { method: "POST", body: JSON.stringify(input) }),
  uploadImage: (campaignId: string, image: { name: string; dataUrl: string }) =>
    request<ImageAttachment>(`/api/campaigns/${campaignId}/images`, { method: "POST", body: JSON.stringify(image) }),
  campaignImages: (campaignId: string) => request<ImageAttachment[]>(`/api/campaigns/${campaignId}/images`),
  deleteImage: (id: string) => request<{ deleted: boolean }>(`/api/images/${id}`, { method: "DELETE" }),
  setCampaignCover: (campaignId: string, imageId: string | null) =>
    request<Campaign>(`/api/campaigns/${campaignId}/cover`, { method: "PUT", body: JSON.stringify({ imageId }) }),
  setDocumentAvatar: (docId: string, imageId: string | null) =>
    request<Document>(`/api/documents/${docId}/avatar`, { method: "PUT", body: JSON.stringify({ imageId }) }),
  documentImages: (docId: string) => request<ImageAttachment[]>(`/api/documents/${docId}/images`),
  attachDocumentImage: (docId: string, imageId: string) =>
    request<ImageAttachment[]>(`/api/documents/${docId}/images`, { method: "POST", body: JSON.stringify({ imageId }) }),
  detachDocumentImage: (docId: string, imageId: string) =>
    request<ImageAttachment[]>(`/api/documents/${docId}/images/${imageId}`, { method: "DELETE" }),
  startImageGeneration: (docId: string, prompt: string) =>
    request<{ started: boolean }>(`/api/documents/${docId}/image-generation`, { method: "POST", body: JSON.stringify({ prompt }) }),
  imageGenerationStatus: (docId: string) =>
    request<{ running: boolean; error: string | null; image?: ImageAttachment }>(`/api/documents/${docId}/image-generation`),
  stopImageGeneration: async (docId: string) => {
    const res = await fetch(`/api/documents/${docId}/image-generation/stop`, { method: "POST" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: string };
      throw new ApiError(res.status, body.error || res.statusText);
    }
  },
  getDocument: (id: string) => request<Document>(`/api/documents/${id}`),
  deleteDocument: (id: string) =>
    fetch(`/api/documents/${id}`, { method: "DELETE" }).then((res) => {
      if (!res.ok) throw new ApiError(res.status, res.statusText);
    }),
  updateDocument: (id: string, patch: DocumentPatch) =>
    request<Document>(`/api/documents/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  brainstorm: (campaignId: string, message: string) =>
    request<BrainstormResponse>(`/api/campaigns/${campaignId}/brainstorm`, { method: "POST", body: JSON.stringify({ message }) }),
  // Серверная фоновая генерация мастерской: старт / статус.
  startBrainstorm: (campaignId: string, message: string, images?: ImageAttachment[]) =>
    request<{ started: boolean }>(`/api/campaigns/${campaignId}/brainstorm/start`, { method: "POST", body: JSON.stringify({ message, ...(images?.length ? { imageIds: images.map((i) => i.id) } : {}) }) }),
  brainstormStatus: (campaignId: string) =>
    request<{ running: boolean; partial: string; error: string | null }>(`/api/campaigns/${campaignId}/brainstorm/status`),
  startWorkshopTopic: (campaignId: string) =>
    request<ConversationMessage>(`/api/campaigns/${campaignId}/brainstorm/new-topic`, { method: "POST" }),
  listProposals: (campaignId: string, status?: string) =>
    request<Proposal[]>(`/api/campaigns/${campaignId}/proposals${status ? `?status=${status}` : ""}`),
  approveProposal: (id: string) =>
    request<Document>(`/api/proposals/${id}/approve`, { method: "POST" }),
  rejectProposal: (id: string) =>
    request<Proposal>(`/api/proposals/${id}/reject`, { method: "POST" }),
  getConversation: (campaignId: string) =>
    request<ConversationMessage[]>(`/api/campaigns/${campaignId}/conversation`),
  nextSession: (docId: string) =>
    request<Document>(`/api/documents/${docId}/next-session`, { method: "POST" }),
  getDocumentConversation: (docId: string) =>
    request<ConversationMessage[]>(`/api/documents/${docId}/conversation`),
  addDocumentMessage: (docId: string, role: "user" | "assistant", content: string) =>
    request<ConversationMessage>(`/api/documents/${docId}/conversation/messages`, {
      method: "POST",
      body: JSON.stringify({ role, content }),
    }),
  // Серверная генерация помощника документа: старт / статус / остановка.
  // opts.mode="game" + opts.meta — игровой чат режима игры (актор действия).
  startAssistant: (docId: string, message: string, system?: string, opts?: { mode?: "game"; meta?: MessageMeta; images?: ImageAttachment[] }) =>
    request<{ started: boolean }>(`/api/documents/${docId}/assistant`, {
      method: "POST",
      body: JSON.stringify({ message, system, ...(opts?.mode ? { mode: opts.mode } : {}), ...(opts?.meta ? { meta: opts.meta } : {}), ...(opts?.images?.length ? { imageIds: opts.images.map((i) => i.id) } : {}) }),
    }),
  assistantStatus: (docId: string) =>
    request<{ running: boolean; partial: string; error: string | null }>(`/api/documents/${docId}/assistant`),
  stopAssistant: (docId: string) =>
    fetch(`/api/documents/${docId}/assistant/stop`, { method: "POST" }).then(() => undefined),
  stopBrainstorm: (campaignId: string) =>
    fetch(`/api/campaigns/${campaignId}/brainstorm/stop`, { method: "POST" }).then(() => undefined),
  // Переключение важности записи лога в игровом чате.
  updateMessageMeta: (messageId: string, patch: { log: GameLogEntry }) =>
    request<ConversationMessage>(`/api/messages/${messageId}/meta`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  clearDocumentConversation: (docId: string) =>
    fetch(`/api/documents/${docId}/conversation`, { method: "DELETE" }).then((res) => {
      if (!res.ok) throw new ApiError(res.status, res.statusText);
    }),
  worldSummary: (campaignId: string) =>
    request<{ summary: string; question: string }>(`/api/campaigns/${campaignId}/world`),
  llmUsage: (campaignId: string) =>
    request<LlmUsageStats>(`/api/campaigns/${campaignId}/llm-usage`),
  llmUsageGlobal: () => request<GlobalLlmUsageStats>("/api/llm-usage"),
  importCampaignJson: (data: unknown) =>
    request<Campaign>("/api/campaigns/import-json", { method: "POST", body: JSON.stringify(data) }),
  checkConsistency: (campaignId: string) =>
    request<ConsistencyResult>(`/api/campaigns/${campaignId}/consistency`),
  search: (campaignId: string, q: string) =>
    request<SearchHit[]>(`/api/campaigns/${campaignId}/search?q=${encodeURIComponent(q)}`),
  createLink: (input: NewLink) =>
    request<Link>(`/api/campaigns/${input.campaignId}/links`, { method: "POST", body: JSON.stringify(input) }),
  listCampaignLinks: (campaignId: string) => request<Link[]>(`/api/campaigns/${campaignId}/links`),
  listDocumentLinks: (docId: string) =>
    request<DocumentLinks>(`/api/documents/${docId}/links`),
  deleteLink: (id: string) =>
    fetch(`/api/links/${id}`, { method: "DELETE" }).then((res) => {
      if (!res.ok) throw new ApiError(res.status, res.statusText);
    }),
};
