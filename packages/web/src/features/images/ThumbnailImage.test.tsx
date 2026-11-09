import { fireEvent, render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ImagePreview } from "./ImageViewer.js";

const images = [{ id: "landscape", name: "Галерея.webp", mimeType: "image/webp" as const }];

describe("image delivery", () => {
  it("uses resized copies before opening and the original only inside the viewer", async () => {
    render(<ImagePreview images={images} />);
    const preview = screen.getByRole("img");
    expect(preview).toHaveAttribute("src", "/api/images/landscape/thumbnail?size=256");
    expect(preview).toHaveAttribute("srcset", "/api/images/landscape/thumbnail?size=256 1x, /api/images/landscape/thumbnail?size=512 2x");
    expect(preview).toHaveAttribute("loading", "lazy");
    expect(preview).toHaveAttribute("decoding", "async");
    expect(document.querySelector('img[src="/api/images/landscape"]')).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Открыть Галерея.webp" }));
    const dialog = screen.getByRole("dialog", { name: "Просмотр изображения" });
    expect(within(dialog).getByRole("img")).toHaveAttribute("src", "/api/images/landscape");
    expect(within(dialog).getByRole("img")).not.toHaveAttribute("srcset");
    expect(within(dialog).getByRole("link", { name: "Скачать изображение" })).toHaveAttribute("href", "/api/images/landscape");
  });

  it("does not silently download the original if a thumbnail fails", () => {
    render(<ImagePreview images={images} />);
    fireEvent.error(screen.getByRole("img"));
    expect(document.querySelector('img[src="/api/images/landscape"]')).toBeNull();
  });
});
