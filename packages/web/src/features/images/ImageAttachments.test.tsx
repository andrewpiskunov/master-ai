import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { api } from "../../api/client.js";
import { ImageAttachments } from "./ImageAttachments.js";
import { useImageDraft } from "./useImageDraft.js";
import { MentionTextarea } from "../../ui/MentionTextarea.js";

vi.mock("../../api/client.js");
beforeEach(() => { vi.resetAllMocks(); Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() }); });
afterEach(() => vi.unstubAllGlobals());
function Harness({ context = "d1" }: { context?: string }) {
  const draft = useImageDraft(context);
  const [text, setText] = useState("");
  return <><MentionTextarea id="text" value={text} onChange={setText} onEnter={vi.fn()} mentions={[{ title: "Барон", type: "npc" }]} onPaste={draft.onPaste} /><ImageAttachments draft={draft} /><button onClick={() => { void draft.upload("c1"); }}>Upload</button></>;
}
function paste(files: File[]) {
  return fireEvent.paste(screen.getByRole("textbox"), { clipboardData: { items: [], files } });
}
function file(name: string) { return new File([name], name, { type: "image/png" }); }

describe("ImageAttachments clipboard", () => {
  it("keeps ordinary text paste and mention completion working", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByRole("textbox");
    await user.click(input);
    await user.paste("Текст @Ба");
    expect(input).toHaveValue("Текст @Ба");
    // Клик, как и ввод, пересчитывает меню после штатной вставки браузера.
    await user.click(input);
    await user.keyboard("{Enter}");
    expect(input).toHaveValue("Текст Барон ");
    expect(api.uploadImage).not.toHaveBeenCalled();
  });

  it("accepts files fallback, reserves multiple concurrent pastes, and removes a preview", async () => {
    render(<Harness />);
    expect(paste([file("a.png"), file("b.png")])).toBe(false);
    paste([file("c.png"), file("d.png"), file("e.png")]);
    await waitFor(() => expect(screen.getAllByRole("img")).toHaveLength(4));
    expect(screen.getByRole("alert")).toHaveTextContent(/Не больше 4/);
    expect(screen.queryByAltText("e.png")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Убрать b.png" }));
    expect(screen.queryByAltText("b.png")).not.toBeInTheDocument();
    expect(screen.getAllByRole("img")).toHaveLength(3);
  });

  it("rejects oversized files and unsupported image formats before reading or uploading", async () => {
    render(<Harness />);
    const large = file("large.png");
    Object.defineProperty(large, "size", { value: 10 * 1024 * 1024 + 1 });
    paste([large, new File(["gif"], "bad.gif", { type: "image/gif" })]);
    expect(screen.getByRole("alert")).toHaveTextContent(/10 МБ/);
    expect(screen.getByRole("alert")).toHaveTextContent(/PNG, JPEG и WebP/);
    expect(screen.queryAllByRole("img")).toHaveLength(0);
    expect(api.uploadImage).not.toHaveBeenCalled();
  });

  it("does not resurrect removed images or an old document after delayed reads finish", async () => {
    const readers: { result: string; onload?: () => void }[] = [];
    vi.stubGlobal("FileReader", class {
      result = "data:image/png;base64,cG5n";
      onload?: () => void;
      readAsDataURL() { readers.push(this); }
    });
    const view = render(<Harness />);
    paste([file("removed.png")]);
    await userEvent.click(screen.getByRole("button", { name: "Убрать removed.png" }));
    act(() => readers[0].onload?.());
    expect(screen.queryAllByRole("img")).toHaveLength(0);
    paste([file("old.png")]);
    view.rerender(<Harness context="d2" />);
    act(() => readers[1].onload?.());
    expect(screen.queryByAltText("old.png")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Убрать old.png" })).not.toBeInTheDocument();
  });
});
