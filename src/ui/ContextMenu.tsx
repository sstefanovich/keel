import { LucideIcon } from "lucide-react";
import { createContext, ReactNode, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";

export interface MenuItem {
  label: string;
  icon?: LucideIcon;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
  /** Why it's disabled, or extra detail */
  hint?: string;
  /** Keyboard shortcut shown on the right, e.g. "Ctrl+W" */
  shortcut?: string;
}

/** A separator between groups of items */
export const SEP = "sep" as const;
export type MenuEntry = MenuItem | typeof SEP;

interface MenuState {
  /** Left edge, or the right edge when `alignRight` (a menu dropping from a button at the right) */
  x: number;
  alignRight?: boolean;
  y: number;
  entries: MenuEntry[];
}

type MouseLike = { clientX: number; clientY: number; preventDefault(): void; alignRight?: boolean };
type OpenMenu = (e: MouseLike, entries: MenuEntry[], onClose?: () => void) => void;

const Ctx = createContext<OpenMenu>(() => {});

/** Open a right-click menu at the mouse: `onContextMenu={(e) => openMenu(e, [...])}`; `onClose` runs when it goes away. */
export function useContextMenu() {
  return useContext(Ctx);
}

export function ContextMenuProvider({ children }: { children: ReactNode }) {
  const [menu, setMenu] = useState<MenuState | null>(null);
  // the open menu's onClose, called outside of any state update
  const closing = useRef<(() => void) | undefined>(undefined);
  const settle = () => {
    const fn = closing.current;
    closing.current = undefined;
    fn?.();
  };
  const open = useCallback<OpenMenu>((e, entries, onClose) => {
    e.preventDefault();
    settle();
    closing.current = onClose;
    setMenu({ x: e.clientX, y: e.clientY, entries, alignRight: e.alignRight });
  }, []);
  const close = useCallback(() => {
    settle();
    setMenu(null);
  }, []);
  return (
    <Ctx.Provider value={open}>
      {children}
      {menu && <Menu state={menu} onClose={close} />}
    </Ctx.Provider>
  );
}

function Menu({ state, onClose }: { state: MenuState; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: state.x, y: state.y });
  const [sel, setSel] = useState(-1);
  const items = state.entries.filter((e): e is MenuItem => e !== SEP);

  // keep the menu on screen
  useLayoutEffect(() => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const left = state.alignRight ? state.x - r.width : state.x;
    setPos({ x: Math.max(8, Math.min(left, window.innerWidth - r.width - 8)), y: Math.min(state.y, window.innerHeight - r.height - 8) });
  }, [state]);

  useEffect(() => {
    ref.current?.focus();
    const close = (e: Event) => {
      if (e.type === "mousedown" && ref.current?.contains(e.target as Node)) return;
      onClose();
    };
    window.addEventListener("mousedown", close, true);
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
    window.addEventListener("wheel", close, true);
    return () => {
      window.removeEventListener("mousedown", close, true);
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("wheel", close, true);
    };
  }, [onClose]);

  const choose = (item: MenuItem) => {
    if (item.disabled) return;
    onClose();
    item.onSelect();
  };

  return (
    <div
      ref={ref}
      className="context-menu"
      role="menu"
      tabIndex={-1}
      style={{ left: pos.x, top: pos.y }}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
        else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          const n = items.length;
          const step = e.key === "ArrowDown" ? 1 : -1;
          // skip disabled items
          setSel((s) => {
            let i = s;
            for (let k = 0; k < n; k++) {
              i = (((i + step) % n) + n) % n;
              if (!items[i].disabled) return i;
            }
            return s;
          });
        } else if (e.key === "Enter" && items[sel]) choose(items[sel]);
      }}
    >
      {state.entries.map((entry, i) => {
        if (entry === SEP) return <div key={`sep${i}`} className="context-sep" role="separator" />;
        const idx = items.indexOf(entry);
        const Icon = entry.icon;
        return (
          <button
            key={entry.label}
            role="menuitem"
            className={`context-item${entry.danger ? " danger" : ""}${idx === sel ? " on" : ""}`}
            disabled={entry.disabled}
            title={entry.hint}
            onMouseEnter={() => setSel(idx)}
            onClick={() => choose(entry)}
          >
            {Icon ? <Icon size={14} aria-hidden="true" /> : <span className="context-icon-gap" />}
            <span>{entry.label}</span>
            {entry.shortcut && <kbd className="context-shortcut">{entry.shortcut}</kbd>}
          </button>
        );
      })}
    </div>
  );
}
