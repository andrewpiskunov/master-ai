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

    await userEvent.click(screen.getByRole("button", { name: /продолжить/i }));
    await waitFor(() => expect(streamComplete).toHaveBeenCalled());
    // предложение вставлено в документ
    expect(await screen.findByText(/Барон мрачен\./)).toBeInTheDocument();
    // принять
    await userEvent.click(screen.getByRole("button", { name: /принять/i }));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    // кнопки принять/отклонить исчезли
    expect(screen.queryByRole("button", { name: /принять/i })).not.toBeInTheDocument();
  });

  it("отклонение удаляет предложенный текст", async () => {
    vi.mocked(streamComplete).mockImplementation(async (_input, onChunk) => {
      onChunk("временный текст");
      return "временный текст";
    });
    render(<DocumentEditor content={{ type: "doc", content: [] }} onChange={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /продолжить/i }));
    expect(await screen.findByText("временный текст")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /отклонить/i }));
    await waitFor(() =>
      expect(screen.queryByText("временный текст")).not.toBeInTheDocument(),
    );
  });
});
