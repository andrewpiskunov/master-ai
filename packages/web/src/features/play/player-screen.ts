import { ImageAttachmentSchema, type ImageAttachment } from "@master-ai/shared";

export interface PlayerImageState {
  image: ImageAttachment | null;
  captionVisible: boolean;
}
export type PlayerScreenMessage = { type: "ready"; channelId: string } | ({ type: "state"; channelId: string } & PlayerImageState);

export const validPlayerChannelId = (value: string): boolean => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export const playerChannelName = (channelId: string): string => `master-ai-player-screen:${channelId}`;

// Construct a fresh allow-listed payload at either end of the channel. Entity
// text, arbitrary URLs and any extra fields never become player screen state.
export function parsePlayerScreenMessage(value: unknown, channelId: string): PlayerScreenMessage | null {
  if (!validPlayerChannelId(channelId) || !value || typeof value !== "object" || Array.isArray(value)) return null;
  const message = value as Record<string, unknown>;
  if (message.channelId !== channelId) return null;
  if (message.type === "ready") return { type: "ready", channelId };
  if (message.type !== "state" || typeof message.captionVisible !== "boolean") return null;
  if (message.image === null) return { type: "state", channelId, image: null, captionVisible: false };
  const image = ImageAttachmentSchema.safeParse(message.image);
  return image.success ? { type: "state", channelId, image: image.data, captionVisible: message.captionVisible } : null;
}
