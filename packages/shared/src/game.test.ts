import { describe, it, expect } from "vitest";
import { extractLogBlock, fallbackLogTitle, parseGameSections } from "./game.js";

describe("extractLogBlock", () => {
  it("вырезает закрытый log-блок и парсит JSON", () => {
    const text = "## Прочитай игрокам\nЗамок щёлкает.\n```log\n{\"title\": \"Алдар взломал замок\", \"important\": true}\n```";
    const { log, rest } = extractLogBlock(text);
    expect(log).toEqual({ title: "Алдар взломал замок", important: true });
    expect(rest).not.toContain("```log");
    expect(rest).toContain("Замок щёлкает.");
  });

  it("незакрытый блок во время стрима — прячет хвост, log null", () => {
    const { log, rest } = extractLogBlock("Текст ответа\n```log\n{\"title\": \"обры");
    expect(log).toBeNull();
    expect(rest).toBe("Текст ответа\n");
  });

  it("битый JSON — блок вырезан, log null", () => {
    const { log, rest } = extractLogBlock("Ответ\n```log\nне json\n```");
    expect(log).toBeNull();
    expect(rest).toBe("Ответ");
  });

  it("без блока — текст как есть", () => {
    expect(extractLogBlock("Просто ответ")).toEqual({ log: null, rest: "Просто ответ" });
  });

  it("important не-boolean трактуется как false", () => {
    const { log } = extractLogBlock("```log\n{\"title\": \"Событие\", \"important\": \"да\"}\n```");
    expect(log).toEqual({ title: "Событие", important: false });
  });
});

describe("fallbackLogTitle", () => {
  it("короткое действие возвращается как есть", () => {
    expect(fallbackLogTitle("взламывает замок")).toBe("взламывает замок");
  });
  it("длинное — обрезается с многоточием", () => {
    const t = fallbackLogTitle("а".repeat(100));
    expect(t.length).toBeLessThanOrEqual(60);
    expect(t.endsWith("…")).toBe(true);
  });
});

describe("parseGameSections", () => {
  it("делит на «Прочитай игрокам» и «Скрытое для мастера»", () => {
    const s = parseGameSections("Вступление.\n## Прочитай игрокам\nДверь отворяется.\n## Скрытое для мастера\nЗа дверью ловушка.");
    expect(s.intro).toBe("Вступление.");
    expect(s.read).toBe("Дверь отворяется.");
    expect(s.hidden).toBe("За дверью ловушка.");
  });

  it("ответ без секций — всё в intro", () => {
    const s = parseGameSections("Сложность проверки — 14.");
    expect(s).toEqual({ intro: "Сложность проверки — 14.", read: null, hidden: null });
  });

  it("терпит ### и вариации заголовка скрытой секции", () => {
    const s = parseGameSections("### Прочитай игрокам\nТекст.\n### Скрытая информация для мастера\nТайна.");
    expect(s.read).toBe("Текст.");
    expect(s.hidden).toBe("Тайна.");
  });

  it("только читаемая секция — hidden null", () => {
    const s = parseGameSections("## Прочитай игрокам\nВы входите в зал.");
    expect(s.read).toBe("Вы входите в зал.");
    expect(s.hidden).toBeNull();
  });
});
