import { ArrowLeft, ArrowRight, ArrowRightToLine, Copy, CopyPlus, Pin, PinOff, Plus, RotateCcw, X, XCircle } from "lucide-react";
import { MouseEvent, useState } from "react";
import { copyText } from "../lib/platform";
import { MenuEntry, SEP, useContextMenu } from "./ContextMenu";
import { useHold } from "./HoldContext";
import { TabInfo, useNav } from "./nav";
import { viewMeta } from "./viewMeta";
import { WindowControls } from "./WindowControls";

/** Back/forward, the open tabs (drag to reorder, middle-click to close, right-click for more) and a new-tab button. */
export function TabBar() {
  const { hold, bump, toast, reportError } = useHold();
  const nav = useNav();
  const openMenu = useContextMenu();
  const [dragId, setDragId] = useState<string | null>(null);
  // the tab whose right-click menu is open, outlined so it's clear what "Close others" means
  const [menuFor, setMenuFor] = useState<string | null>(null);

  const tabMenu = (t: TabInfo): MenuEntry[] => {
    const others = nav.tabs.filter((x) => x.id !== t.id).map((x) => x.id);
    const i = nav.tabs.findIndex((x) => x.id === t.id);
    const right = nav.tabs.slice(i + 1).map((x) => x.id);
    const entries: MenuEntry[] = [
      { label: "Close", icon: X, shortcut: t.id === nav.activeTab ? "Ctrl+W" : undefined, onSelect: () => nav.closeTab(t.id) },
      { label: "Close others", icon: XCircle, disabled: !others.length, onSelect: () => nav.closeTabs(others) },
      { label: "Close tabs to the right", icon: ArrowRightToLine, disabled: !right.length, onSelect: () => nav.closeTabs(right) },
      { label: "Close all", onSelect: () => nav.closeTabs(nav.tabs.map((x) => x.id)) },
      SEP,
      { label: "Duplicate tab", icon: CopyPlus, onSelect: () => nav.duplicateTab(t.id) },
      { label: "Reopen closed tab", icon: RotateCcw, shortcut: "Ctrl+Shift+T", disabled: !nav.canReopenTab, onSelect: nav.reopenClosedTab },
    ];
    if (t.view.kind === "file") {
      const path = t.view.path;
      const pinned = hold.isPinned(path);
      const pin = (on: boolean) => () => {
        hold.setPinned(path, on).then(bump).catch(reportError);
      };
      entries.push(
        SEP,
        pinned ? { label: "Unpin from sidebar", icon: PinOff, onSelect: pin(false) } : { label: "Pin to sidebar", icon: Pin, onSelect: pin(true) },
        {
          label: "Copy path",
          icon: Copy,
          hint: path,
          onSelect: () => {
            copyText(path)
              .then(() => toast("Path copied"))
              .catch(reportError);
          },
        },
      );
    }
    return entries;
  };

  // a keyboard-opened menu (Menu key, Shift+F10) has no mouse position: start it at the tab's left
  const onTabMenu = (e: MouseEvent<HTMLDivElement>, t: TabInfo) => {
    // the menu drops just below the tab (at the pointer's x), so the marked tab stays in view
    const r = e.currentTarget.getBoundingClientRect();
    const at = { clientX: e.clientX || e.clientY ? e.clientX : r.left + 8, clientY: r.bottom + 2, preventDefault: () => e.preventDefault() };
    setMenuFor(t.id);
    openMenu(at, tabMenu(t), () => setMenuFor(null));
  };

  return (
    // the tab strip is also the window's title bar: empty space drags it, double-click maximises
    <div className="tabbar" data-tauri-drag-region>
      <div className="tabbar-nav">
        <button className="tab-icon-btn" onClick={nav.back} disabled={!nav.canBack} title="Back (Ctrl+[)" aria-label="Back">
          <ArrowLeft size={15} />
        </button>
        <button className="tab-icon-btn" onClick={nav.forward} disabled={!nav.canForward} title="Forward (Ctrl+])" aria-label="Forward">
          <ArrowRight size={15} />
        </button>
      </div>
      <div className="tabs" role="tablist" data-tauri-drag-region>
        {nav.tabs.map((t, i) => {
          const { title, Icon } = viewMeta(t.view, hold);
          const active = t.id === nav.activeTab;
          return (
            <div
              key={t.id}
              role="tab"
              aria-selected={active}
              tabIndex={0}
              className={`tab${active ? " active" : ""}${dragId === t.id ? " dragging" : ""}${menuFor === t.id ? " menu-open" : ""}`}
              title={title}
              draggable
              onDragStart={(e) => {
                setDragId(t.id);
                e.dataTransfer.effectAllowed = "move";
              }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (dragId) nav.moveTab(dragId, i);
                setDragId(null);
              }}
              onDragEnd={() => setDragId(null)}
              onMouseDown={(e) => {
                if (e.button === 1) e.preventDefault(); // no autoscroll on middle-click
              }}
              onMouseUp={(e) => {
                if (e.button === 1) nav.closeTab(t.id);
              }}
              onClick={() => nav.selectTab(t.id)}
              onContextMenu={(e) => onTabMenu(e, t)}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && nav.selectTab(t.id)}
            >
              <Icon size={14} className="tab-icon" aria-hidden="true" />
              <span className="tab-title">{title}</span>
              <button
                className="tab-close"
                onClick={(e) => {
                  e.stopPropagation();
                  nav.closeTab(t.id);
                }}
                aria-label={`Close ${title}`}
                title="Close (Ctrl+W)"
              >
                <X size={13} />
              </button>
            </div>
          );
        })}
        <button className="tab-icon-btn tab-new" onClick={nav.newTab} title="New tab" aria-label="New tab">
          <Plus size={15} />
        </button>
      </div>
      <div className="tabbar-drag" data-tauri-drag-region />
      {/* with the Claude chat open, the controls move to its header, at the window's corner */}
      {!nav.claudeOpen && <WindowControls />}
    </div>
  );
}
