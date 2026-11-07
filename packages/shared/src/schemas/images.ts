import { z } from "zod";

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_MESSAGE_IMAGES = 4;
export const ImageMimeTypeSchema = z.enum(["image/png", "image/jpeg", "image/webp"]);

export const ImageAttachmentSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(200),
  mimeType: ImageMimeTypeSchema,
});
export type ImageAttachment = z.infer<typeof ImageAttachmentSchema>;

export const ImageIdsSchema = z.array(z.string().uuid()).max(MAX_MESSAGE_IMAGES);

// Validate the decoded size and file signature without Node-specific APIs so
// browser uploads, stored media and direct LLM requests share the same rules.
export const ImageDataUrlSchema = z.string().max(Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 64).superRefine((value, ctx) => {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  let valid = false;
  if (match && match[2].length % 4 === 0) {
    const encoded = match[2];
    const bytes = encoded.length / 4 * 3 - (encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0);
    try {
      const header = atob(encoded.slice(0, 32));
      valid = bytes <= MAX_IMAGE_BYTES && (
        (match[1] === "image/png" && header.startsWith("\x89PNG\r\n\x1a\n")) ||
        (match[1] === "image/jpeg" && header.startsWith("\xff\xd8\xff")) ||
        (match[1] === "image/webp" && header.startsWith("RIFF") && header.slice(8, 12) === "WEBP")
      );
    } catch { /* Invalid base64 is rejected below. */ }
  }
  if (!valid) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Нужно изображение PNG, JPEG или WebP размером до 10 МБ" });
});

export const ImageUploadSchema = z.object({
  name: z.string().min(1).max(200),
  dataUrl: ImageDataUrlSchema,
});
export type LlmImage = z.infer<typeof ImageUploadSchema>;
