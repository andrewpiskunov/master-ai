import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { App } from "./App.js";

describe("App", () => {
  it("рендерит заголовок приложения", () => {
    render(<App />);
    expect(screen.getByText("master-ai")).toBeInTheDocument();
  });
});
