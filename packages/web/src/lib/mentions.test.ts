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

describe("prepareMentions: одноимённые документы", () => {
  it("сливает записи с одинаковым названием в одну со списком hrefs", () => {
    const out = prepareMentions([
      { title: "Корона Королей", type: "arc", href: "a1" },
      { title: "корона королей", type: "secret", href: "s1" },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].href).toBe("a1");
    expect(out[0].hrefs).toEqual(["a1", "s1"]);
  });

  it("уникальное название остаётся без hrefs", () => {
    const out = prepareMentions([{ title: "Крысолов", type: "npc", href: "d1" }]);
    expect(out[0].hrefs).toBeUndefined();
  });
});

describe("matchMentions", () => {
  it("спан неоднозначного упоминания несёт все hrefs", () => {
    const prepared = prepareMentions([
      { title: "Корона Королей", type: "arc", href: "a1" },
      { title: "Корона Королей", type: "secret", href: "s1" },
    ]);
    const spans = matchMentions("Их ждёт Корона Королей", prepared);
    expect(spans).toHaveLength(1);
    expect(spans[0].hrefs).toEqual(["a1", "s1"]);
  });

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

  it("переносит href в найденный спан (для кликабельных ссылок)", () => {
    const prepared = prepareMentions([{ title: "Крысолов", type: "npc", href: "/campaigns/c1/documents/d1" }]);
    const spans = matchMentions("Зовите Крысолов", prepared);
    expect(spans[0].href).toBe("/campaigns/c1/documents/d1");
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
