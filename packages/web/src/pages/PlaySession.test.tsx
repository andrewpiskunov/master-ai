import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PlaySession } from "./PlaySession.js";
import { api } from "../api/client.js";
import { ToastProvider } from "../ui/toast.js";

vi.mock("../api/client.js");
vi.mock("../api/stream.js");

const sessionDoc = {
  id: "d1", campaignId: "c1", type: "session", title: "Сессия 1", status: null,
  contentJson: { type: "doc", content: [
    { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Завязка" }] },
    { type: "paragraph", content: [{ type: "text", text: "Партия в порту." }] },
  ] },
  fields: { sessionNumber: 1 }, createdAt: "x", updatedAt: "x",
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.getDocument).mockResolvedValue(sessionDoc);
  vi.mocked(api.getCampaign).mockResolvedValue({ id: "c1", name: "Корона", system: null, description: "", realism: "balanced", llmProvider: "cli" as const, llmSettings: {}, createdAt: "x" });
  vi.mocked(api.listCampaignDocuments).mockResolvedValue([]);
  vi.mocked(api.getDocumentConversation).mockResolvedValue([]);
});

describe("PlaySession (smoke)", () => {
  it("рендерит режим игры: вкладки, AI-лог и «Следующая сессия»", async () => {
    render(
      <ToastProvider>
        <MemoryRouter initialEntries={["/campaigns/c1/sessions/d1/play"]}>
          <Routes><Route path="/campaigns/:campaignId/sessions/:documentId/play" element={<PlaySession />} /></Routes>
        </MemoryRouter>
      </ToastProvider>,
    );
    expect(await screen.findByText("Лог сессии")).toBeInTheDocument();
    expect(screen.getByText("Ассистент")).toBeInTheDocument();
    expect(screen.getByText("Бой")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Дописать в лог с ИИ/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Следующая сессия/ })).toBeInTheDocument();
  });
});
