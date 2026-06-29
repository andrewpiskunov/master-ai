import { describe, it, expect } from "vitest";
import { createDb } from "../db/client.js";
import { DocumentService } from "./documents.js";
import { LinkService } from "./links.js";

function setup() {
  const { db } = createDb(":memory:");
  const documents = new DocumentService(db);
  const links = new LinkService(db);
  const a = documents.create({ campaignId: "c1", type: "npc", title: "Барон" });
  const b = documents.create({ campaignId: "c1", type: "location", title: "Замок" });
  return { documents, links, a, b };
}

describe("LinkService", () => {
  it("create сохраняет связь", () => {
    const { links, a, b } = setup();
    const l = links.create({ campaignId: "c1", fromDocId: a.id, toDocId: b.id, kind: "обитает в" });
    expect(l.id).toBeTruthy();
    expect(l.kind).toBe("обитает в");
  });

  it("listForDocument разделяет исходящие и обратные связи с данными документа", () => {
    const { links, a, b } = setup();
    links.create({ campaignId: "c1", fromDocId: a.id, toDocId: b.id, kind: "обитает в" });
    const fromA = links.listForDocument(a.id);
    expect(fromA.outgoing).toHaveLength(1);
    expect(fromA.outgoing[0].document.title).toBe("Замок");
    expect(fromA.incoming).toHaveLength(0);
    const fromB = links.listForDocument(b.id);
    expect(fromB.incoming).toHaveLength(1);
    expect(fromB.incoming[0].document.title).toBe("Барон");
    expect(fromB.incoming[0].kind).toBe("обитает в");
  });

  it("delete удаляет связь", () => {
    const { links, a, b } = setup();
    const l = links.create({ campaignId: "c1", fromDocId: a.id, toDocId: b.id, kind: "обитает в" });
    expect(links.delete(l.id)).toBe(true);
    expect(links.listForDocument(a.id).outgoing).toHaveLength(0);
    expect(links.delete(l.id)).toBe(false);
  });
});
