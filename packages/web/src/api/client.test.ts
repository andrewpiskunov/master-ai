import { describe, it, expect, vi, afterEach } from "vitest";
import { api, ApiError } from "./client.js";

afterEach(() => vi.unstubAllGlobals());

function stubFetch(status: number, body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(body), { status })),
  );
}

describe("api client", () => {
  it("listCampaigns возвращает массив", async () => {
    stubFetch(200, [{ id: "c1", name: "A", system: null, description: null, createdAt: "x" }]);
    const result = await api.listCampaigns();
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("A");
  });

  it("createCampaign шлёт POST с телом", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ id: "c1", name: "A", system: null, description: null, createdAt: "x" }), { status: 201 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await api.createCampaign({ name: "A" });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/campaigns",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("бросает ApiError при не-2xx", async () => {
    stubFetch(404, { error: "not found" });
    await expect(api.getCampaign("nope")).rejects.toBeInstanceOf(ApiError);
  });
});

describe("image API payloads", () => {
  const image = { id: "img1", name: "map.png", mimeType: "image/png" as const };
  it("sends only image IDs with workshop messages", async () => {
    stubFetch(202, { started: true });
    await api.startBrainstorm("c1", "", [image]);
    expect(fetch).toHaveBeenCalledWith("/api/campaigns/c1/brainstorm/start", expect.objectContaining({ body: JSON.stringify({ message: "", imageIds: ["img1"] }) }));
  });
  it("preserves game mode and actor metadata alongside image IDs", async () => {
    stubFetch(202, { started: true });
    await api.startAssistant("d1", "", "system", { mode: "game", meta: { actorKind: "pc", actorName: "Лис" }, images: [image] });
    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string);
    expect(body).toEqual({ message: "", system: "system", mode: "game", meta: { actorKind: "pc", actorName: "Лис" }, imageIds: ["img1"] });
    expect(body).not.toHaveProperty("images");
  });
  it("surfaces server errors when stopping image generation", async () => {
    stubFetch(503, { error: "Codex недоступен" });
    await expect(api.stopImageGeneration("d1")).rejects.toThrow("Codex недоступен");
  });
});
