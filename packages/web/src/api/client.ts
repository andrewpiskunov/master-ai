import type {
  Campaign,
  NewCampaign,
  Document,
  NewDocument,
  DocumentTypeDef,
  Proposal,
  BrainstormResponse,
  ConversationMessage,
} from "@master-ai/shared";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
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

type DocumentPatch = Partial<Pick<Document, "title" | "status" | "contentJson" | "fields">>;

export const api = {
  listDocumentTypes: () => request<DocumentTypeDef[]>("/api/document-types"),
  listCampaigns: () => request<Campaign[]>("/api/campaigns"),
  createCampaign: (input: NewCampaign) =>
    request<Campaign>("/api/campaigns", { method: "POST", body: JSON.stringify(input) }),
  getCampaign: (id: string) => request<Campaign>(`/api/campaigns/${id}`),
  listCampaignDocuments: (campaignId: string) =>
    request<Document[]>(`/api/campaigns/${campaignId}/documents`),
  createDocument: (input: NewDocument) =>
    request<Document>("/api/documents", { method: "POST", body: JSON.stringify(input) }),
  getDocument: (id: string) => request<Document>(`/api/documents/${id}`),
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
};
