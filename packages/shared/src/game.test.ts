import { describe, it, expect } from "vitest";
import { dedupeGameTail, extractLogBlock, fallbackLogTitle, parseGameSections, stripChoicePrompts, stripLogFence } from "./game.js";

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
    expect(extractLogBlock("Просто ответ")).toEqual({ log: null, rest: "Просто ответ", after: "" });
  });

  it("текст после log-блока отдаётся отдельно (after)", () => {
    const { log, rest, after } = extractLogBlock(
      "## Прочитай игрокам\nСцена.\n```log\n{\"title\": \"Событие\", \"important\": false}\n```\nПродолжение сцены после блока.",
    );
    expect(log?.title).toBe("Событие");
    expect(rest).toContain("Сцена.");
    expect(rest).not.toContain("Продолжение");
    expect(after).toBe("Продолжение сцены после блока.");
  });

  it("important не-boolean трактуется как false", () => {
    const { log } = extractLogBlock("```log\n{\"title\": \"Событие\", \"important\": \"да\"}\n```");
    expect(log).toEqual({ title: "Событие", important: false });
  });
});

describe("stripLogFence", () => {
  it("удаляет log-блок, склеивая текст до и после", () => {
    const s = stripLogFence("Сцена.\n```log\n{\"title\": \"Событие\", \"important\": false}\n```\nПродолжение.");
    expect(s).toBe("Сцена.\n\nПродолжение.");
    expect(s).not.toContain("```log");
  });
  it("текст без блока — как есть", () => {
    expect(stripLogFence("Просто ответ")).toBe("Просто ответ");
  });
});

describe("dedupeGameTail", () => {
  it("убирает абзацы, дословно повторяющие показанный текст", () => {
    const rest = "## Прочитай игрокам\nТы входишь в зал. Свет гаснет.";
    const after = "Ты входишь в зал. Свет гаснет.\n\nИз темноты слышен голос.";
    expect(dedupeGameTail(after, rest)).toBe("Из темноты слышен голос.");
  });
  it("повтор с другими пробелами тоже считается дублем", () => {
    const rest = "Ты входишь в зал.\nСвет гаснет.";
    const after = "Ты входишь в зал. Свет гаснет.";
    expect(dedupeGameTail(after, rest)).toBe("");
  });
  it("новый текст не трогает", () => {
    expect(dedupeGameTail("Совсем новый абзац.", "Старая сцена.")).toBe("Совсем новый абзац.");
  });
});

describe("stripChoicePrompts", () => {
  it("убирает блок с заголовком «Как ты ответишь…?» и список пунктов-вопросов", () => {
    const text =
      "Голос стар и скрипуч.\n\n**Как ты ответишь Ра'Кширу Шепчущему?**\n\n" +
      "*   Представишься и скажешь, что вы пришли за мудростью?\n*   Спросишь, кто он?\n*   Или у тебя есть другая идея?";
    expect(stripChoicePrompts(text)).toBe("Голос стар и скрипуч.");
  });
  it("«Что вы делаете дальше?» тоже вычищается", () => {
    const text = "Сцена.\n\n**Что вы делаете дальше?**\n\n* Идти к мудрецу?\n* Осмотреть библиотеку?";
    expect(stripChoicePrompts(text)).toBe("Сцена.");
  });
  it("полезные пункты-утверждения не трогает", () => {
    const text = "- Перед сундуком растяжка: Восприятие СЛ 13.\n- Охранник появится через 2 раунда.";
    expect(stripChoicePrompts(text)).toBe(text);
  });
  it("обычный текст с вопросом в диалоге сохраняется", () => {
    const text = "Старец щурится. \"Зачем пришли?\" — спрашивает он.";
    expect(stripChoicePrompts(text)).toBe(text);
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
