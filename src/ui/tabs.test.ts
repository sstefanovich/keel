import { describe, expect, it } from "vitest";
import {
  activeTab,
  canBack,
  canForward,
  closeTab,
  currentView,
  cycleTab,
  go,
  initTabs,
  moveTab,
  navigate,
  reopenClosed,
  restoreTabs,
  serializeTabs,
} from "./tabs";

type V = { kind: string; path?: string; line?: number };
const A: V = { kind: "agenda" };
const T: V = { kind: "timesheet" };
const F = (path: string, line?: number): V => ({ kind: "file", path, line });
const isV = (v: unknown): v is V => typeof v === "object" && v !== null && typeof (v as V).kind === "string";

describe("tabs", () => {
  it("navigates within a tab with back/forward history", () => {
    let s = initTabs<V>(A);
    s = navigate(s, T);
    s = navigate(s, F("notes/a.md"));
    expect(currentView(s)).toEqual(F("notes/a.md"));
    expect(canBack(s)).toBe(true);
    s = go(s, -1);
    expect(currentView(s)).toEqual(T);
    expect(canForward(s)).toBe(true);
    // navigating after going back drops the forward history
    s = navigate(s, A);
    expect(canForward(s)).toBe(false);
    expect(activeTab(s).history).toEqual([A, T, A]);
  });

  it("re-opening the same file at another line replaces instead of stacking", () => {
    let s = initTabs<V>(F("notes/a.md"));
    s = navigate(s, F("notes/a.md", 12));
    expect(activeTab(s).history).toEqual([F("notes/a.md", 12)]);
    s = navigate(s, A);
    s = navigate(s, A);
    expect(activeTab(s).history).toHaveLength(2);
  });

  it("opens new tabs after the active one, cycles, closes and reopens", () => {
    let s = initTabs<V>(A);
    const first = s.active;
    s = navigate(s, T, true);
    s = navigate(s, F("x.md"), true);
    expect(s.tabs.map((t) => currentView({ ...s, active: t.id }).kind)).toEqual(["agenda", "timesheet", "file"]);
    s = cycleTab(s, 1);
    expect(s.active).toBe(first); // wraps
    s = cycleTab(s, -1);
    expect(currentView(s)).toEqual(F("x.md"));
    s = closeTab(s, s.active, A);
    expect(currentView(s)).toEqual(T); // the neighbour becomes active
    s = reopenClosed(s);
    expect(currentView(s)).toEqual(F("x.md"));
    expect(s.closed).toHaveLength(0);
  });

  it("closing the last tab leaves a fresh one", () => {
    let s = initTabs<V>(T);
    s = closeTab(s, s.active, A);
    expect(s.tabs).toHaveLength(1);
    expect(currentView(s)).toEqual(A);
    expect(reopenClosed(s).tabs).toHaveLength(2);
  });

  it("reorders tabs", () => {
    let s = initTabs<V>(A);
    s = navigate(s, T, true);
    const t = s.active;
    s = moveTab(s, t, 0);
    expect(s.tabs[0].id).toBe(t);
  });

  it("round-trips through storage and drops invalid entries", () => {
    let s = initTabs<V>(A);
    s = navigate(s, F("a.md"));
    s = navigate(s, T, true);
    const back = restoreTabs<V>(serializeTabs(s), isV)!;
    expect(back.tabs.map((t) => t.history)).toEqual(s.tabs.map((t) => t.history));
    expect(back.active).toBe(s.active);
    expect(restoreTabs<V>("not json", isV)).toBeNull();
    expect(restoreTabs<V>(JSON.stringify({ tabs: [{ id: "x", history: [1, 2], index: 0 }], active: "x" }), isV)).toBeNull();
  });
});
