import { ListTree } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { outlineOf } from "../core/parse";

/** The file's headings as a dropdown; picking one jumps there. Shown when a note has a few. */
export function Outline({ content, onJump }: { content: string; onJump: (line: number) => void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const items = outlineOf(content);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);

  if (items.length < 3) return null;
  const top = Math.min(...items.map((i) => i.level));

  return (
    <div className="outline" ref={box}>
      <button className="ghost icon-text" onClick={() => setOpen(!open)} aria-expanded={open} title="Jump to a heading (fold sections with the ▾ beside them, or Ctrl+Shift+[ )">
        <ListTree size={14} aria-hidden="true" />
        Outline
      </button>
      {open && (
        <ul className="outline-menu" role="menu">
          {items.map((h) => (
            <li key={h.line} style={{ paddingLeft: (h.level - top) * 14 }}>
              <button
                role="menuitem"
                className={h.level === top ? "top" : ""}
                onClick={() => {
                  setOpen(false);
                  onJump(h.line);
                }}
              >
                {h.text}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
