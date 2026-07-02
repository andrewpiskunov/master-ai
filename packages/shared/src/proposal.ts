import { z } from "zod";
import type { MessageMeta } from "./game.js";

export const ProposalStatusSchema = z.enum(["pending", "approved", "rejected"]);
export type ProposalStatus = z.infer<typeof ProposalStatusSchema>;

export const ProposalActionSchema = z.enum(["create", "update"]);
export type ProposalAction = z.infer<typeof ProposalActionSchema>;

export const ProposalSchema = z.object({
  id: z.string(),
  campaignId: z.string(),
  conversationId: z.string(),
  type: z.string(),
  title: z.string(),
  content: z.string(),
  fields: z.record(z.unknown()),
  action: ProposalActionSchema,
  status: ProposalStatusSchema,
  createdAt: z.string(),
});
export type Proposal = z.infer<typeof ProposalSchema>;

export const DraftProposalSchema = z.object({
  type: z.string(),
  title: z.string().min(1),
  content: z.string().min(1),
  fields: z.record(z.unknown()).optional(),
  // "update" — изменить существующий документ с таким же title; по умолчанию "create".
  action: ProposalActionSchema.optional(),
});
export type DraftProposal = z.infer<typeof DraftProposalSchema>;

export interface ConversationMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  meta?: MessageMeta;
}

export interface BrainstormResponse {
  conversationId: string;
  reply: string;
  proposals: Proposal[];
}
