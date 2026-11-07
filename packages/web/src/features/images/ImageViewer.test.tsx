import { fireEvent, render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { MessageImages } from "./ImageAttachments.js";

const images = [
  { id: "portrait", name: "portrait.png", mimeType: "image/png" as const },
  { id: "map", name: "map.webp", mimeType: "image/webp" as const },
];

function Location() {
  return <output aria-label="Текущий путь">{useLocation().pathname}</output>;
}

afterEach(() => { document.body.style.overflow = ""; });

describe("in-app image viewer", () => {
  it("places a game chat image viewer above the full-screen play surface", async () => {
    const styles = document.createElement("style");
    styles.textContent = readFileSync("src/app/styles.css", "utf8")
      + readFileSync("src/features/images/ImageViewer.css", "utf8");
    document.head.append(styles);
    try {
      render(<div className="play-mode" data-testid="play-surface"><MessageImages images={images} /></div>);
      await userEvent.click(screen.getByRole("button", { name: "Открыть portrait.png" }));
      const backdrop = screen.getByRole("dialog").parentElement!;
      expect(Number(getComputedStyle(backdrop).zIndex)).toBeGreaterThan(Number(getComputedStyle(screen.getByTestId("play-surface")).zIndex));
    } finally { styles.remove(); }
  });

  it("opens the selected chat image without leaving the route and restores focus and scroll locking on Escape", async () => {
    const user = userEvent.setup();
    document.body.style.overflow = "auto";
    render(<MemoryRouter initialEntries={["/campaigns/c1/documents/baron"]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Location /><MessageImages images={images} />
    </MemoryRouter>);
    const trigger = screen.getByRole("button", { name: "Открыть map.webp" });
    await user.click(trigger);

    const dialog = screen.getByRole("dialog", { name: "Просмотр изображения" });
    expect(within(dialog).getByRole("img", { name: "map.webp" })).toHaveAttribute("src", "/api/images/map");
    expect(within(dialog).getByText("2 / 2")).toBeInTheDocument();
    expect(screen.getByLabelText("Текущий путь")).toHaveTextContent("/campaigns/c1/documents/baron");
    expect(document.body.style.overflow).toBe("hidden");
    expect(within(dialog).getByRole("button", { name: "Закрыть просмотр" })).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(document.body.style.overflow).toBe("auto");
  });

  it("navigates the provided gallery with arrows and buttons and resets the zoom for each image", async () => {
    const user = userEvent.setup();
    render(<MessageImages images={images} />);
    await user.click(screen.getByRole("button", { name: "Открыть portrait.png" }));
    const dialog = screen.getByRole("dialog");
    const zoom = within(dialog).getByRole("button", { name: "Масштаб 100%" });
    expect(zoom).toHaveAttribute("aria-pressed", "false");
    await user.click(zoom);
    expect(zoom).toHaveAttribute("aria-pressed", "true");

    await user.keyboard("{ArrowRight}");
    expect(within(dialog).getByRole("img")).toHaveAttribute("src", "/api/images/map");
    expect(within(dialog).getByRole("button", { name: "Масштаб 100%" })).toHaveAttribute("aria-pressed", "false");
    expect(within(dialog).getByRole("link", { name: "Скачать изображение" })).toHaveAttribute("href", "/api/images/map");
    expect(within(dialog).getByRole("link", { name: "Скачать изображение" })).toHaveAttribute("download", "map.webp");
    await user.keyboard("{ArrowLeft}");
    expect(within(dialog).getByRole("img")).toHaveAttribute("src", "/api/images/portrait");
    await user.click(within(dialog).getByRole("button", { name: "Следующее изображение" }));
    expect(within(dialog).getByText("2 / 2")).toBeInTheDocument();
  });

  it("keeps keyboard focus inside the viewer and closes with its close control", async () => {
    const user = userEvent.setup();
    render(<><button>Вне просмотра</button><MessageImages images={images} /></>);
    await user.click(screen.getByRole("button", { name: "Открыть portrait.png" }));
    const dialog = screen.getByRole("dialog");
    const close = within(dialog).getByRole("button", { name: "Закрыть просмотр" });
    await user.tab({ shift: true });
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    await user.tab();
    expect(close).toHaveFocus();
    await user.click(close);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("dismisses an old viewer when its image collection changes", async () => {
    const user = userEvent.setup();
    const view = render(<MessageImages images={images} />);
    await user.click(screen.getByRole("button", { name: "Открыть portrait.png" }));
    view.rerender(<MessageImages images={[{ id: "new", name: "new.png", mimeType: "image/png" }]} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(document.body.style.overflow).toBe("");
  });

  it("explains an unavailable image and allows moving to the next image", async () => {
    const user = userEvent.setup();
    render(<MessageImages images={images} />);
    await user.click(screen.getByRole("button", { name: "Открыть portrait.png" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.error(within(dialog).getByRole("img"));
    expect(within(dialog).getByRole("alert")).toHaveTextContent("Не удалось загрузить изображение");
    expect(within(dialog).getByRole("button", { name: "Масштаб 100%" })).toBeDisabled();
    await user.keyboard("{ArrowRight}");
    expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument();
    expect(within(dialog).getByRole("img")).toHaveAttribute("src", "/api/images/map");
    expect(within(dialog).getByRole("button", { name: "Масштаб 100%" })).toBeEnabled();
  });
});
