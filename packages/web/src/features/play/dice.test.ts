import { describe, it, expect } from "vitest";
import { rollDice } from "./dice.js";

describe("rollDice", () => {
  it("разбирает NdM+K и держит сумму в диапазоне", () => {
    const r = rollDice("2d6+3");
    expect(r).not.toBeNull();
    expect(r!.rolls).toHaveLength(2);
    expect(r!.modifier).toBe(3);
    r!.rolls.forEach((v) => { expect(v).toBeGreaterThanOrEqual(1); expect(v).toBeLessThanOrEqual(6); });
    expect(r!.total).toBeGreaterThanOrEqual(2 + 3);
    expect(r!.total).toBeLessThanOrEqual(12 + 3);
  });

  it("d20 без количества и модификатора", () => {
    const r = rollDice("d20");
    expect(r!.rolls).toHaveLength(1);
    expect(r!.modifier).toBe(0);
    expect(r!.total).toBeGreaterThanOrEqual(1);
    expect(r!.total).toBeLessThanOrEqual(20);
  });

  it("поддерживает отрицательный модификатор", () => {
    const r = rollDice("1d4-1");
    expect(r!.modifier).toBe(-1);
    expect(r!.total).toBeGreaterThanOrEqual(0);
  });

  it("возвращает null на неверной формуле", () => {
    expect(rollDice("abc")).toBeNull();
    expect(rollDice("20")).toBeNull();
  });
});
