import { render, screen, within, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client.js";
import { ImagePreview } from "./ImageViewer.js";

vi.mock("../../api/client.js");
beforeEach(() => { vi.resetAllMocks(); document.body.style.overflow = "auto"; });
const image = (id: string) => ({ id, name: `${id}.png`, mimeType: "image/png" as const });
async function openDelete(id: string) {
  await userEvent.click(screen.getByRole("button", { name: `Открыть ${id}.png` }));
  await userEvent.click(within(screen.getByRole("dialog", { name: "Просмотр изображения" })).getByRole("button", { name: `Удалить ${id}.png` }));
  return screen.getByRole("alertdialog", { name: "Удалить изображение?" });
}

describe("permanent image deletion", () => {
  it("names the image, explains its scope and lets Escape cancel without deleting", async () => {
    render(<ImagePreview images={[image("cancel")]} />);
    const dialog = await openDelete("cancel");
    expect(dialog).toHaveTextContent("cancel.png");
    expect(dialog).toHaveTextContent(/карточек.*переписок/);
    expect(within(dialog).getByRole("button", { name: "Отмена" })).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Просмотр изображения" })).toBeInTheDocument();
    expect(api.deleteImage).not.toHaveBeenCalled();
  });

  it("deletes only after confirmation, removes every duplicate preview and keeps other images", async () => {
    const target = image("delete");
    render(<><ImagePreview images={[target, image("keep")]} /><ImagePreview images={[target]} label="Дубликат" /><ImagePreview images={[image("keep")]} /></>);
    const dialog = await openDelete("delete");
    vi.mocked(api.deleteImage).mockResolvedValue({ deleted: true });
    await userEvent.click(within(dialog).getByRole("button", { name: "Удалить изображение" }));
    await waitFor(() => expect(screen.queryByAltText("delete.png")).not.toBeInTheDocument());
    expect(api.deleteImage).toHaveBeenCalledWith("delete");
    expect(screen.getByAltText("keep.png")).toBeInTheDocument();
    expect(document.body.style.overflow).toBe("auto");
  });

  it("keeps the confirmation and image after failure and allows retry", async () => {
    render(<ImagePreview images={[image("retry")]} />);
    const dialog = await openDelete("retry");
    vi.mocked(api.deleteImage).mockRejectedValueOnce(new Error("Нет связи с сервером")).mockResolvedValueOnce({ deleted: true });
    await userEvent.click(within(dialog).getByRole("button", { name: "Удалить изображение" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Нет связи с сервером");
    expect(screen.getAllByAltText("retry.png").length).toBeGreaterThan(0);
    await userEvent.click(within(dialog).getByRole("button", { name: "Удалить изображение" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
  });

  it("traps focus and blocks escape, duplicate submission and viewer navigation while deleting", async () => {
    render(<ImagePreview images={[image("pending"), image("other")]} />);
    const dialog = await openDelete("pending");
    await userEvent.tab({ shift: true });
    expect(within(dialog).getByRole("button", { name: "Удалить изображение" })).toHaveFocus();
    let finish!: (result: { deleted: boolean }) => void;
    vi.mocked(api.deleteImage).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Удалить изображение" }));
    await userEvent.keyboard("{Escape}{ArrowRight}");
    expect(dialog).toBeInTheDocument();
    expect(within(screen.getByRole("dialog", { name: "Просмотр изображения" })).getByRole("img")).toHaveAttribute("src", "/api/images/pending");
    expect(api.deleteImage).toHaveBeenCalledTimes(1);
    finish({ deleted: true });
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
  });
});
