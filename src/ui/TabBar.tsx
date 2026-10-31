import { ArrowLeft, ArrowRight, Plus, X } from "lucide-react";
import { useState } from "react";
import { useHold } from "./HoldContext";
import { useNav } from "./nav";
import { viewMeta } from "./viewMeta";
import { WindowControls } from "./WindowControls";

/** Back/forward, the open tabs (drag to reorder, middle-click to close) and a new-tab button. */
export function TabBar() {
  const { hold } = useHold();
  const nav = useNav();
  const [dragId, setDragId] = useState<string | null>(null);

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
              className={`tab${active ? " active" : ""}${dragId === t.id ? " dragging" : ""}`}
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
