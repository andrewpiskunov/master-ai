import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";

export interface SelectOption { value: string; label: string }

// Кастомная выпадашка под тёмную тему вместо нативного <select>.
export function Select({
  value,
  options,
  onChange,
  id,
  ariaLabel,
  placeholder = "—",
  tag = false,
  dotColor,
}: {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  id?: string;
  ariaLabel?: string;
  placeholder?: string;
  tag?: boolean;
  dotColor?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className={`select${tag ? " select-tag" : ""}`} ref={ref}>
      <button
        type="button"
        id={id}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="select-trigger"
        onClick={() => setOpen((v) => !v)}
      >
        {dotColor && <span className="select-dot" style={{ background: dotColor }} />}
        <span className={`select-value${current ? "" : " select-placeholder"}`}>{current?.label ?? placeholder}</span>
        <ChevronDown size={tag ? 14 : 16} className="select-caret" />
      </button>
      {open && (
        <ul className="select-menu" role="listbox" aria-label={ariaLabel}>
          {options.map((o) => (
            <li
              key={o.value}
              role="option"
              aria-selected={o.value === value}
              className={`select-option${o.value === value ? " selected" : ""}`}
              onClick={() => { onChange(o.value); setOpen(false); }}
            >
              <span className="select-check">{o.value === value && <Check size={15} />}</span>
              <span className="select-label">{o.label}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
