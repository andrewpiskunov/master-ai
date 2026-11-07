import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildApp } from "../packages/server/src/app.js";
import { createDb } from "../packages/server/src/db/client.js";
import { FakeProvider } from "../packages/server/src/llm/fake.js";

// Exercise the public import/export API against an isolated in-memory database.
// No network requests, AI credentials or user data are involved.
const raw = await readFile(new URL("../examples/demo-campaign.json", import.meta.url), "utf8");
const example = JSON.parse(raw);
assert.equal(example.format, "master-ai-campaign");
assert.equal(example.version, 1);
assert.ok(example.documents.length > 0, "The example must contain documents");
assert.ok(!raw.includes('"apiKey"'), "The example must not contain API keys");
const originalIds = new Set(example.documents.map((doc: { id: string }) => doc.id));
assert.equal(originalIds.size, example.documents.length, "Document IDs must be unique");
for (const link of example.links) {
  assert.ok(originalIds.has(link.fromDocId) && originalIds.has(link.toDocId), "Broken example link");
}

const { db, sqlite } = createDb(":memory:");
const app = buildApp({ db, sqlite, llm: new FakeProvider([]) });
try {
  const response = await app.inject({ method: "POST", url: "/api/campaigns/import-json", payload: example });
  assert.equal(response.statusCode, 201, response.body);
  const imported = response.json();
  const exported = await app.inject({ method: "GET", url: `/api/campaigns/${imported.id}/export-json` });
  assert.equal(exported.statusCode, 200);
  const result = exported.json();
  for (const key of ["documents", "links", "conversations", "messages", "proposals", "llmUsage"] as const) {
    assert.equal(result[key].length, example[key].length, `Import lost ${key}`);
  }
  const newIds = new Set(result.documents.map((doc: { id: string }) => doc.id));
  for (const id of newIds) assert.ok(!originalIds.has(id), "Import must generate new document IDs");
  for (const link of result.links) {
    assert.ok(newIds.has(link.fromDocId) && newIds.has(link.toDocId), "Import broke a link");
  }
  const search = await app.inject({ method: "GET", url: `/api/campaigns/${imported.id}/search?q=${encodeURIComponent("маяк")}` });
  assert.equal(search.statusCode, 200);
  assert.ok(search.json().length > 0, "Imported content must be searchable");
  const second = await app.inject({ method: "POST", url: "/api/campaigns/import-json", payload: example });
  assert.equal(second.statusCode, 201);
  assert.notEqual(second.json().id, imported.id, "Import must create a separate campaign");
  console.log(`Demo verified: ${result.documents.length} documents, ${result.links.length} links; import, export, search and repeat import passed.`);
} finally {
  await app.close();
  sqlite.close();
}
