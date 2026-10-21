/**
 * Tabs, each with its own back/forward history. Pure functions over a plain state object
 * so they're easy to test and to persist.
 */

export interface Tab<V> {
  id: string;
  history: V[];
  index: number;
}

export interface TabsState<V> {
  tabs: Tab<V>[];
  active: string;
  /** Recently closed tabs, newest last (for "reopen closed tab") */
  closed: Tab<V>[];
}

const MAX_HISTORY = 50;
const MAX_CLOSED = 10;
let counter = 0;
const newId = () => `t${Date.now().toString(36)}${(counter++).toString(36)}`;

const same = <V>(a: V, b: V) => JSON.stringify(a) === JSON.stringify(b);

export function initTabs<V>(view: V): TabsState<V> {
  const id = newId();
  return { tabs: [{ id, history: [view], index: 0 }], active: id, closed: [] };
}

export function activeTab<V>(s: TabsState<V>): Tab<V> {
  return s.tabs.find((t) => t.id === s.active) ?? s.tabs[0];
}

export function currentView<V>(s: TabsState<V>): V {
  const t = activeTab(s);
  return t.history[t.index];
}

/** Show a view in the active tab (pushing history), or in a new tab after the active one. */
export function navigate<V>(s: TabsState<V>, view: V, newTab = false): TabsState<V> {
  if (newTab) {
    const id = newId();
    const at = s.tabs.findIndex((t) => t.id === s.active) + 1;
    const tabs = [...s.tabs.slice(0, at), { id, history: [view], index: 0 }, ...s.tabs.slice(at)];
    return { ...s, tabs, active: id };
  }
  const tab = activeTab(s);
  // re-opening what's showing (e.g. the same file at another line) replaces rather than stacks
  const replace = same(tab.history[tab.index], view) || sameTarget(tab.history[tab.index], view);
  const history = replace
    ? tab.history.map((v, i) => (i === tab.index ? view : v))
    : [...tab.history.slice(0, tab.index + 1), view].slice(-MAX_HISTORY);
  const index = replace ? tab.index : history.length - 1;
  return { ...s, tabs: s.tabs.map((t) => (t.id === tab.id ? { ...t, history, index } : t)) };
}

/** Two file views of the same file count as the same place (only the line differs). */
function sameTarget<V>(a: V, b: V): boolean {
  const x = a as { kind?: string; path?: string };
  const y = b as { kind?: string; path?: string };
  return x?.kind === "file" && y?.kind === "file" && x.path === y.path;
}

export function canBack<V>(s: TabsState<V>): boolean {
  return activeTab(s).index > 0;
}

export function canForward<V>(s: TabsState<V>): boolean {
  const t = activeTab(s);
  return t.index < t.history.length - 1;
}

export function go<V>(s: TabsState<V>, delta: -1 | 1): TabsState<V> {
  const t = activeTab(s);
  const index = Math.max(0, Math.min(t.history.length - 1, t.index + delta));
  return index === t.index ? s : { ...s, tabs: s.tabs.map((x) => (x.id === t.id ? { ...x, index } : x)) };
}

export function selectTab<V>(s: TabsState<V>, id: string): TabsState<V> {
  return s.tabs.some((t) => t.id === id) ? { ...s, active: id } : s;
}

/** Next/previous tab, wrapping around. */
export function cycleTab<V>(s: TabsState<V>, delta: 1 | -1): TabsState<V> {
  const i = s.tabs.findIndex((t) => t.id === s.active);
  return { ...s, active: s.tabs[(i + delta + s.tabs.length) % s.tabs.length].id };
}

/** Close a tab; closing the last one leaves a fresh tab showing `fallback`. */
export function closeTab<V>(s: TabsState<V>, id: string, fallback: V): TabsState<V> {
  const i = s.tabs.findIndex((t) => t.id === id);
  if (i < 0) return s;
  const closed = [...s.closed, s.tabs[i]].slice(-MAX_CLOSED);
  const tabs = s.tabs.filter((t) => t.id !== id);
  if (!tabs.length) {
    const fresh = initTabs(fallback);
    return { ...fresh, closed };
  }
  const active = s.active === id ? tabs[Math.min(i, tabs.length - 1)].id : s.active;
  return { tabs, active, closed };
}

export function reopenClosed<V>(s: TabsState<V>): TabsState<V> {
  const last = s.closed[s.closed.length - 1];
  if (!last) return s;
  const at = s.tabs.findIndex((t) => t.id === s.active) + 1;
  return { tabs: [...s.tabs.slice(0, at), last, ...s.tabs.slice(at)], active: last.id, closed: s.closed.slice(0, -1) };
}

/** Move a tab to another position (drag to reorder). */
export function moveTab<V>(s: TabsState<V>, id: string, to: number): TabsState<V> {
  const from = s.tabs.findIndex((t) => t.id === id);
  if (from < 0) return s;
  const tabs = [...s.tabs];
  const [t] = tabs.splice(from, 1);
  tabs.splice(Math.max(0, Math.min(to, tabs.length)), 0, t);
  return { ...s, tabs };
}

/** Keep the parts worth restoring: open tabs (with trimmed history) and the active one. */
export function serializeTabs<V>(s: TabsState<V>): string {
  return JSON.stringify({ tabs: s.tabs.map((t) => ({ ...t, history: t.history.slice(-20), index: Math.min(t.index, 19) })), active: s.active });
}

export function restoreTabs<V>(json: string | null, isValid: (v: unknown) => v is V): TabsState<V> | null {
  if (!json) return null;
  try {
    const raw = JSON.parse(json) as { tabs: Tab<unknown>[]; active: string };
    const tabs = raw.tabs
      .map((t) => {
        const history = (t.history ?? []).filter(isValid) as V[];
        return history.length ? { id: String(t.id), history, index: Math.min(Math.max(0, t.index), history.length - 1) } : null;
      })
      .filter((t): t is Tab<V> => t !== null);
    if (!tabs.length) return null;
    return { tabs, active: tabs.some((t) => t.id === raw.active) ? raw.active : tabs[0].id, closed: [] };
  } catch {
    return null;
  }
}
