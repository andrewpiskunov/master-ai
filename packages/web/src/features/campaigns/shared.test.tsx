import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import type { Document } from "@master-ai/shared";
import { DocCard } from "./shared.js";

const document: Document = {
  id: "d1", campaignId: "c1", type: "location", title: "Башня", status: null,
  contentJson: null, fields: {}, createdAt: "x", updatedAt: "x",
  avatar: { id: "img1", name: "tower.png", mimeType: "image/png" },
};

describe("entity cards", () => {
  it.each(["tile", "row"] as const)("shows a location avatar in a %s card while keeping one whole-card link", (variant) => {
    render(<MemoryRouter><DocCard doc={document} variant={variant} /></MemoryRouter>);
    const card = screen.getByRole("link", { name: /^Башня/ });
    expect(card).toHaveAttribute("href", "/campaigns/c1/documents/d1");
    expect(card.querySelector("img")).toHaveAttribute("src", "/api/images/img1");
    expect(within(card).queryByRole("button")).not.toBeInTheDocument();
  });

  it("uses the entity type icon when no avatar is available", () => {
    render(<MemoryRouter><DocCard doc={{ ...document, avatar: null }} /></MemoryRouter>);
    const card = screen.getByRole("link", { name: /^Башня/ });
    expect(card.querySelector("img")).toBeNull();
    expect(card.querySelector(".type-tile svg")).not.toBeNull();
  });
});
