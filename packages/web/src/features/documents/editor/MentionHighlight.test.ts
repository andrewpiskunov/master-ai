import { afterEach, describe, expect, it, vi } from "vitest";
import { Editor } from "@tiptap/core";
import { baseExtensions } from "./extensions.js";
import { MentionHighlight, mentionKey, type MentionItem } from "./MentionHighlight.js";

const editors: Editor[] = [];
const target = "/campaigns/c1/documents/npc-1";

afterEach(() => {
  editors.forEach((editor) => editor.destroy());
  editors.length = 0;
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

function createEditor(mentions: MentionItem[], content = "<p>Встреча: Серый Прелат.</p>", onOpen: ((title: string) => void) | null = null) {
  const element = document.createElement("div");
  document.body.append(element);
  const editor = new Editor({
    element,
    extensions: [...baseExtensions, MentionHighlight.configure({ onOpen })],
    content,
  });
  editors.push(editor);
  editor.view.dispatch(editor.state.tr.setMeta(mentionKey, { mentions }));
  return editor;
}

function dispatchMouse(target: Element, type: string, init: MouseEventInit = {}) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, ...init });
  let preventedByEditor = false;
  // Observe the editor's handling, then stop jsdom from attempting navigation.
  const observe = (received: Event) => {
    preventedByEditor = received.defaultPrevented;
    received.preventDefault();
  };
  document.body.addEventListener(type, observe, { once: true });
  target.dispatchEvent(event);
  return preventedByEditor;
}

describe("MentionHighlight native links", () => {
  it("gives a mention a canonical link without adding a link mark to saved content", () => {
    const editor = createEditor([{ title: "Серый Прелат", type: "npc", href: target }]);
    const link = editor.view.dom.querySelector("a.mention-npc");
    expect(link).toHaveAttribute("href", "/campaigns/c1/documents/npc-1");
    expect(link).toHaveTextContent("Серый Прелат");
    expect(link?.getAttribute("title")).toMatch(/новой вкладке|новом окне/);
    expect(editor.getJSON()).toEqual({
      type: "doc", content: [{ type: "paragraph", attrs: { textAlign: null }, content: [{ type: "text", text: "Встреча: Серый Прелат." }] }],
    });
    expect(editor.getHTML()).toBe("<p>Встреча: Серый Прелат.</p>");
  });

  it("keeps ordinary clicks for editing and leaves the mention text editable", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const editor = createEditor([{ title: "Серый Прелат", type: "npc", href: target }]);
    const mention = editor.view.dom.querySelector(".mention")!;
    expect(dispatchMouse(mention, "click")).toBe(true);
    expect(open).not.toHaveBeenCalled();
    editor.commands.setTextSelection(16);
    editor.commands.insertContent("очень ");
    expect(editor.getText()).toBe("Встреча: Серый очень Прелат.");
    expect(JSON.stringify(editor.getJSON())).not.toContain("href");
  });

  it.each([
    ["middle click", "auxclick", { button: 1 }, "noopener"],
    ["Cmd click", "click", { metaKey: true }, "noopener"],
    ["Ctrl click", "click", { ctrlKey: true }, "noopener"],
    ["Shift click", "click", { shiftKey: true }, "noopener,popup"],
  ] as const)("opens the target once for %s in the editable document", (_name, eventType, modifiers, features) => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const opened: string[] = [];
    const editor = createEditor([{ title: "Серый Прелат", type: "npc", href: target }], undefined, (title) => opened.push(title));
    const saved = editor.getJSON();
    const mention = editor.view.dom.querySelector(".mention")!;
    const prevented = dispatchMouse(mention, eventType, modifiers);
    expect(open).toHaveBeenCalledWith("/campaigns/c1/documents/npc-1", "_blank", features);
    expect(prevented).toBe(true);
    if (eventType === "click") {
      const event = new MouseEvent("click", { bubbles: true, cancelable: true, ...modifiers });
      Object.defineProperty(event, "target", { value: mention });
      const handled = editor.view.someProp("handleClick", (handleClick) => handleClick(editor.view, 10, event));
      expect(handled).toBeFalsy();
    }
    expect(open).toHaveBeenCalledTimes(1);
    expect(opened).toEqual([]);
    expect(editor.getJSON()).toEqual(saved);
  });

  it.each(["contextmenu", "auxclick"])("keeps right-button %s for the native link menu", (eventType) => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const editor = createEditor([{ title: "Серый Прелат", type: "npc", href: target }]);
    const mention = editor.view.dom.querySelector(".mention")!;
    expect(dispatchMouse(mention, eventType, { button: 2 })).toBe(false);
    expect(open).not.toHaveBeenCalled();
    expect(mention).toHaveAttribute("href", "/campaigns/c1/documents/npc-1");
  });

  it("uses the first target for duplicate names", () => {
    const editor = createEditor([
      { title: "Серый Прелат", type: "npc", href: target },
      { title: "Серый Прелат", type: "npc", href: "/campaigns/c1/documents/npc-2" },
    ]);
    expect(editor.view.dom.querySelector("a.mention")).toHaveAttribute("href", "/campaigns/c1/documents/npc-1");
  });

  it("highlights names inside existing links without nesting anchors or changing their destination", () => {
    const editor = createEditor(
      [{ title: "Серый Прелат", type: "npc", href: target }],
      '<p><a href="https://example.com/original">Серый Прелат</a></p>',
    );
    expect(editor.view.dom.querySelectorAll("a")).toHaveLength(1);
    expect(editor.view.dom.querySelector("a")).toHaveAttribute("href", "https://example.com/original");
    expect(editor.view.dom.querySelector("a .mention")).toHaveTextContent("Серый Прелат");
  });

  it("keeps the existing Cmd/Ctrl callback for mentions without a URL", () => {
    const opened: string[] = [];
    const editor = createEditor([{ title: "Серый Прелат", type: "npc" }], undefined, (title) => opened.push(title));
    const mention = editor.view.dom.querySelector(".mention")!;
    expect(mention.tagName).toBe("SPAN");
    const event = new MouseEvent("click", { metaKey: true });
    Object.defineProperty(event, "target", { value: mention });
    const handled = editor.view.someProp("handleClick", (handleClick) => handleClick(editor.view, 10, event));
    expect(handled).toBe(true);
    expect(opened).toEqual(["Серый Прелат"]);
  });
});
