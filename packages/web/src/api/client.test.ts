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
