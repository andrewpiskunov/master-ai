import { describe, expect, it } from "vitest";
import { parseImageActions } from "./parse-proposals.js";

const documentId = "969abf0a-92c5-4428-9432-94a41594dc21";
describe("parseImageActions", () => {
  it("extracts only image controls and preserves other JSON and document blocks", () => {
    const prose = 'Ответ\n```doc\n# Заголовок\n```\n```edit-doc\nПравки\n```\n```json\n{"example":1}\n```';
    expect(parseImageActions(prose + '\n```json\n' + JSON.stringify({ imageAttachments: [{ documentId, prompt: "Портрет", setAsAvatar: true }] }) + '\n```'))
      .toEqual({ reply: prose, imageAttachments: [{ documentId, prompt: "Портрет", setAsAvatar: true }] });
  });

  it("retains non-image fields from a mixed JSON block", () => {
    expect(parseImageActions('```json\n' + JSON.stringify({ example: 1, imageAttachments: [{ documentId, path: "/portrait.png" }] }) + '\n```'))
      .toEqual({ reply: '```json\n{\n  "example": 1\n}\n```', imageAttachments: [{ documentId, path: "/portrait.png" }] });
  });

  it("hides malformed image controls and returns an explicit failure rather than executing part of an invalid batch", () => {
    const value = parseImageActions('Текст\n```json\n{"imageAttachments":[broken}\n```\n```json\n' + JSON.stringify({ imageAttachments: [{ documentId, prompt: "Портрет" }] }) + '\n```');
    expect(value.imageAttachments).toEqual([]);
    expect(value.reply).toContain("Не удалось обработать прикрепление изображений");
    expect(value.reply).not.toContain("broken");
  });

  it("leaves unrelated scalar JSON blocks intact", () => {
    expect(parseImageActions('```json\nnull\n```\n```json\n42\n```')).toEqual({ reply: '```json\nnull\n```\n```json\n42\n```', imageAttachments: [] });
  });
});
