import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { CombatTracker, type CombatState } from "./CombatTracker.js";

const empty: CombatState = { round: 1, turn: 0, combatants: [] };

describe("CombatTracker (smoke)", () => {
  it("добавляет участника через форму", async () => {
    const onChange = vi.fn();
    render(<CombatTracker combat={empty} onChange={onChange} />);
    await userEvent.type(screen.getByPlaceholderText("Имя участника"), "Гоблин");
    await userEvent.type(screen.getByLabelText("Инициатива"), "12");
    await userEvent.click(screen.getByRole("button", { name: "Добавить" }));
    const next = onChange.mock.calls.at(-1)![0] as CombatState;
    expect(next.combatants).toHaveLength(1);
    expect(next.combatants[0]).toMatchObject({ name: "Гоблин", init: 12 });
  });

  it("добавляет бойца из персонажей кампании", async () => {
    const onChange = vi.fn();
    render(<CombatTracker combat={empty} onChange={onChange} candidates={[{ id: "n1", title: "Мэрла Вейн", type: "npc" }]} />);
    await userEvent.selectOptions(screen.getByTitle("Добавить из существующих персонажей кампании"), "n1");
    const next = onChange.mock.calls.at(-1)![0] as CombatState;
    expect(next.combatants[0].name).toBe("Мэрла Вейн");
  });

  it("кнопка «Из чата» вызывает onAiFill", async () => {
    const onAiFill = vi.fn();
    render(<CombatTracker combat={empty} onChange={vi.fn()} onAiFill={onAiFill} />);
    await userEvent.click(screen.getByRole("button", { name: /Из чата/ }));
    expect(onAiFill).toHaveBeenCalledOnce();
  });

  it("показывает участников и раунд", () => {
    const state: CombatState = { round: 3, turn: 0, combatants: [{ id: "c1", name: "Утопленник", init: 8, hp: 10, maxHp: 10, conditions: "" }] };
    render(<CombatTracker combat={state} onChange={vi.fn()} />);
    expect(screen.getByText("Утопленник")).toBeInTheDocument();
    expect(screen.getByText("Раунд 3")).toBeInTheDocument();
  });
});
