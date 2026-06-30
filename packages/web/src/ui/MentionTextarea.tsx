import { forwardRef, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { getDocumentType } from "@master-ai/shared";
import { TypeBadge } from "../pages/campaign/shared.js";

export interface MentionOption { title: string; type: string }

interface Props {
  value: string;
  onChange: (v: string) => void;
  onEnter: () => void;
  mentions: MentionOption[];
  id?: string;
  placeholder?: string;
  rows?: number;
  disabled?: boolean;
}

// Поле ввода с автодополнением сущностей по «@» — как в редакторе документа,
// но для обычного textarea (чат Мастерской и помощник по документу).
export const MentionTextarea = forwardRef<HTMLTextAreaElement, Props>(function MentionTextarea(
  { value, onChange, onEnter, mentions, id, placeholder, rows = 1, disabled },
  ref,
) {
  const innerRef = useRef<HTMLTextAreaElement | null>(null);
  const setRefs = (el: HTMLTextAreaElement | null) => {
    innerRef.current = el;
    if (typeof ref === "function") ref(el);
    else if (ref) (ref as React.MutableRefObject<HTMLTextAreaElement | null>).current = el;
  };

  const [menu, setMenu] = useState<{ items: MentionOption[]; index: number; start: number } | null>(null);
  const pendingCaret = useRef<number | null>(null);
  const activeRef = useRef<HTMLLIElement>(null);

  useEffect(() => { activeRef.current?.scrollIntoView({ block: "nearest" }); }, [menu?.index]);

  // После замены текста восстанавливаем позицию курсора.
  useEffect(() => {
    if (pendingCaret.current != null && innerRef.current) {
      innerRef.current.selectionStart = innerRef.current.selectionEnd = pendingCaret.current;
      pendingCaret.current = null;
    }
  });

  // resetIndex=true при изменении текста (новый запрос → курсор на первый пункт);
  // false при перемещении каретки (стрелки/клик) — сохраняем выбранный пункт.
  function detect(text: string, caret: number, resetIndex: boolean) {
    const before = text.slice(0, caret);
    const m = /(?:^|\s)@([^@\s]*)$/.exec(before);
    if (!m) { setMenu(null); return; }
    const query = m[1].toLowerCase();
    const items = mentions.filter((mn) => !query || mn.title.toLowerCase().includes(query)).slice(0, 8);
    if (!items.length) { setMenu(null); return; }
    const start = caret - m[1].length - 1;
    setMenu((prev) => ({
      items,
      start,
      index: resetIndex || !prev || prev.start !== start ? 0 : Math.min(prev.index, items.length - 1),
    }));
  }

  const NAV_KEYS = new Set(["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"]);

  function pick(item: MentionOption) {
    const el = innerRef.current;
    if (!el || !menu) return;
    const caret = el.selectionStart;
    const next = `${value.slice(0, menu.start)}${item.title} ${value.slice(caret)}`;
    pendingCaret.current = menu.start + item.title.length + 1;
    onChange(next);
    setMenu(null);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (menu) {
      if (e.key === "ArrowDown") { e.preventDefault(); setMenu((p) => p && { ...p, index: (p.index + 1) % p.items.length }); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setMenu((p) => p && { ...p, index: (p.index - 1 + p.items.length) % p.items.length }); return; }
      if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); pick(menu.items[menu.index]); return; }
      if (e.key === "Escape") { e.preventDefault(); setMenu(null); return; }
    }
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onEnter(); }
  }

  return (
    <div className="mention-input">
      <textarea
        id={id}
        ref={setRefs}
        rows={rows}
        placeholder={placeholder}
        value={value}
        disabled={disabled}
        onChange={(e) => { onChange(e.target.value); detect(e.target.value, e.target.selectionStart, true); }}
        onKeyUp={(e) => { if (!NAV_KEYS.has(e.key)) detect(e.currentTarget.value, e.currentTarget.selectionStart, false); }}
        onClick={(e) => detect(e.currentTarget.value, e.currentTarget.selectionStart, false)}
        onBlur={() => setTimeout(() => setMenu(null), 120)}
        onKeyDown={onKeyDown}
      />
      {menu && (
        <ul className="mention-menu" role="listbox">
          {menu.items.map((m, i) => (
            <li
              key={`${m.title}-${i}`}
              ref={i === menu.index ? activeRef : undefined}
              role="option"
              aria-selected={i === menu.index}
              className={`mention-opt${i === menu.index ? " active" : ""}`}
              onMouseDown={(e) => { e.preventDefault(); pick(m); }}
            >
              <TypeBadge type={m.type} size={20} />
              <span className="mention-opt-title">{m.title}</span>
              <span className="mention-opt-type">{getDocumentType(m.type)?.label ?? m.type}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
});
