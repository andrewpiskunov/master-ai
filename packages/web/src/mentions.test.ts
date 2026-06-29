import { describe, it, expect } from "vitest";
import { matchMentions, prepareMentions } from "./mentions.js";

describe("prepareMentions", () => {
  it("отбрасывает короткие названия (<3) и сортирует длинные вперёд", () => {
    const out = prepareMentions([
      { title: "Ом", type: "npc" },
      { title: "Серый", type: "faction" },
      { title: "Серый Прелат", type: "npc" },
    ]);
    expect(out.map((m) => m.title)).toEqual(["Серый Прелат", "Серый"]);
  });
});

describe("matchMentions", () => {
  it("находит вхождения по границам слов с типом", () => {
    const prepared = prepareMentions([{ title: "Крысолов", type: "npc" }]);
    const text = "Где Крысолов?";
    const spans = matchMentions(text, prepared);
    expect(spans).toHaveLength(1);
    expect(text.slice(spans[0].start, spans[0].end)).toBe("Крысолов");
    expect(spans[0].type).toBe("npc");
  });

  it("не подсвечивает название внутри более длинного слова", () => {
    const prepared = prepareMentions([{ title: "Бард", type: "npc" }]);
    expect(matchMentions("Барды поют", prepared)).toHaveLength(0);
    expect(matchMentions("Бард поёт", prepared)).toHaveLength(1);
  });

  it("при пересечении выигрывает длинное название, без двойной подсветки", () => {
    const prepared = prepareMentions([
      { title: "Серый", type: "faction" },
      { title: "Серый Прелат", type: "npc" },
    ]);
    const spans = matchMentions("Сюда идёт Серый Прелат сейчас", prepared);
    expect(spans).toHaveLength(1);
    expect(spans[0].type).toBe("npc");
  });

  it("находит несколько разных сущностей и сортирует по позиции", () => {
    const prepared = prepareMentions([
      { title: "Крысолов", type: "npc" },
      { title: "Часовая башня", type: "location" },
    ]);
    const spans = matchMentions("На Часовая башня ждёт Крысолов", prepared);
    expect(spans.map((s) => s.type)).toEqual(["location", "npc"]);
  });
});
