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
  getDocument: (id: string) => request<Document>(`/api/documents/${id}`),
  deleteDocument: (id: string) =>
    fetch(`/api/documents/${id}`, { method: "DELETE" }).then((res) => {
      if (!res.ok) throw new ApiError(res.status, res.statusText);
    }),
  updateDocument: (id: string, patch: DocumentPatch) =>
    request<Document>(`/api/documents/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  brainstorm: (campaignId: string, message: string) =>
    request<BrainstormResponse>(`/api/campaigns/${campaignId}/brainstorm`, { method: "POST", body: JSON.stringify({ message }) }),
  listProposals: (campaignId: string, status?: string) =>
    request<Proposal[]>(`/api/campaigns/${campaignId}/proposals${status ? `?status=${status}` : ""}`),
  approveProposal: (id: string) =>
    request<Document>(`/api/proposals/${id}/approve`, { method: "POST" }),
  rejectProposal: (id: string) =>
    request<Proposal>(`/api/proposals/${id}/reject`, { method: "POST" }),
  getConversation: (campaignId: string) =>
    request<ConversationMessage[]>(`/api/campaigns/${campaignId}/conversation`),
  worldSummary: (campaignId: string) =>
    request<{ summary: string; question: string }>(`/api/campaigns/${campaignId}/world`),
  search: (campaignId: string, q: string) =>
    request<SearchHit[]>(`/api/campaigns/${campaignId}/search?q=${encodeURIComponent(q)}`),
  createLink: (input: NewLink) =>
    request<Link>(`/api/campaigns/${input.campaignId}/links`, { method: "POST", body: JSON.stringify(input) }),
  listDocumentLinks: (docId: string) =>
    request<DocumentLinks>(`/api/documents/${docId}/links`),
  deleteLink: (id: string) =>
    fetch(`/api/links/${id}`, { method: "DELETE" }).then((res) => {
      if (!res.ok) throw new ApiError(res.status, res.statusText);
    }),
};
