import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { DocumentEditor } from "./DocumentEditor.js";
import { streamComplete } from "../api/stream.js";

vi.mock("../api/stream.js");
vi.mock("../ui/toast.js", () => ({ useToast: () => ({ showToast: vi.fn() }) }));

beforeEach(() => vi.resetAllMocks());

describe("DocumentEditor inline-AI", () => {
  it("стримит предложение и принимает его", async () => {
    vi.mocked(streamComplete).mockImplementation(async (_input, onChunk) => {
      onChunk("Барон ");
      onChunk("мрачен.");
      return "Барон мрачен.";
    });
    const onChange = vi.fn();
    render(<DocumentEditor content={{ type: "doc", content: [] }} onChange={onChange} />);

    await userEvent.click(screen.getByRole("button", { name: /дописать/i }));
    await waitFor(() => expect(streamComplete).toHaveBeenCalled());
    // предложение вставлено в документ
    expect(await screen.findByText(/Барон мрачен\./)).toBeInTheDocument();
    // принять
    await userEvent.click(screen.getByRole("button", { name: /принять/i }));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    // Fix 3: кнопки принять/отклонить исчезли
    expect(screen.queryByRole("button", { name: /принять/i })).not.toBeInTheDocument();
    // Fix 3: текст всё ещё присутствует в документе
    expect(screen.getByText(/Барон мрачен\./)).toBeInTheDocument();
    // Fix 3: маркер suggestion снят (нет элементов с классом ai-suggestion)
    expect(document.querySelector(".ai-suggestion")).toBeNull();
  });

  it("отклонение удаляет предложенный текст", async () => {
    vi.mocked(streamComplete).mockImplementation(async (_input, onChunk) => {
      onChunk("временный текст");
      return "временный текст";
    });
    render(<DocumentEditor content={{ type: "doc", content: [] }} onChange={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /дописать/i }));
    expect(await screen.findByText("временный текст")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /отклонить/i }));
    await waitFor(() =>
      expect(screen.queryByText("временный текст")).not.toBeInTheDocument(),
    );
  });

  // Fix 1: onChange не вызывается во время стриминга
  it("не вызывает onChange во время стриминга", async () => {
    let resumeStream!: () => void;
    const streamHang = new Promise<void>((resolve) => {
      resumeStream = resolve;
    });
    vi.mocked(streamComplete).mockImplementation(async (_input, onChunk) => {
      onChunk("чанк");
      await streamHang;
      return "чанк";
    });
    const onChange = vi.fn();
    render(<DocumentEditor content={{ type: "doc", content: [] }} onChange={onChange} />);

    // запускаем стриминг без await — он зависает на streamHang
    const clickPromise = userEvent.click(screen.getByRole("button", { name: /дописать/i }));
    // дожидаемся вставки чанка в документ
    await screen.findByText("чанк");
    // onChange не должен быть вызван во время стриминга
    expect(onChange).not.toHaveBeenCalled();
    // завершаем стриминг
    resumeStream();
    await clickPromise;
    // после завершения стриминга (без accept) onChange всё ещё не вызывался
    await waitFor(() => expect(screen.getByRole("button", { name: /принять/i })).toBeInTheDocument());
    expect(onChange).not.toHaveBeenCalled();
  });

  // Fix 2: частичный стрим сохраняется при ошибке
  it("сохраняет частичный стрим при ошибке и показывает кнопки принять/отклонить", async () => {
    vi.mocked(streamComplete).mockImplementation(async (_input, onChunk) => {
      onChunk("частичный");
      throw new Error("сеть упала");
    });
    render(<DocumentEditor content={{ type: "doc", content: [] }} onChange={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: /дописать/i }));
    // частичный текст остаётся в документе
    expect(await screen.findByText("частичный")).toBeInTheDocument();
    // кнопки принять/отклонить доступны (suggesting=true, streaming=false)
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /принять/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /отклонить/i })).toBeInTheDocument();
    });
  });
});
