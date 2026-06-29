import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, it, expect } from "vitest";
import { ToastProvider, useToast } from "./toast.js";

function Trigger() {
  const { showToast } = useToast();
  return <button onClick={() => showToast("Что-то сломалось")}>бахнуть</button>;
}

describe("ToastProvider", () => {
  it("показывает тост по showToast", async () => {
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    );
    await userEvent.click(screen.getByRole("button", { name: "бахнуть" }));
    expect(await screen.findByText("Что-то сломалось")).toBeInTheDocument();
  });
});
