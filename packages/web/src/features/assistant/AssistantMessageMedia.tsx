import type { MessageMeta } from "@master-ai/shared";
import { MessageImages } from "../images/ImageAttachments.js";
import { WorkshopImageResults, WorkshopMessageImages } from "./WorkshopImages.js";

export function AssistantMessageMedia({ campaignId, documentId, meta, onImagesChange }: {
  campaignId?: string;
  documentId: string;
  meta?: MessageMeta;
  onImagesChange?: () => void;
}) {
  if (!campaignId) return <MessageImages images={meta?.images} />;
  return <>
    <WorkshopMessageImages campaignId={campaignId} images={meta?.images} defaultDocumentId={documentId} onImagesChange={onImagesChange} />
    <WorkshopImageResults campaignId={campaignId} results={meta?.imageAttachments} />
  </>;
}
