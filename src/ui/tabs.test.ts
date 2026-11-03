import { describe, expect, it } from "vitest";
import {
  activeTab,
  canBack,
  canForward,
  closeTab,
  closeTabs,
  currentView,
  cycleTab,
  duplicateTab,
  go,
  initTabs,
  moveTab,
  navigate,
  reopenClosed,
  restoreTabs,
  serializeTabs,
  tabsAfter,
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

  it("closes others, to the right and all, and reopens them", () => {
    let s = initTabs<V>(A);
    const a = s.active;
    s = navigate(s, T, true);
    const t = s.active;
    s = navigate(s, F("x.md"), true);
    s = navigate(s, F("y.md"), true);
    // close to the right of the timesheet while y.md is active: the timesheet takes over
    s = closeTabs(s, tabsAfter(s, t), A);
    expect(s.tabs.map((x) => x.id)).toEqual([a, t]);
    expect(s.active).toBe(t);
    expect(s.closed).toHaveLength(2);
    // reopening brings back the last closed first
    s = reopenClosed(s);
    expect(currentView(s)).toEqual(F("y.md"));
    // close others keeps just the chosen tab, active
    s = closeTabs(
      s,
      s.tabs.filter((x) => x.id !== a).map((x) => x.id),
      A,
    );
    expect(s.tabs.map((x) => x.id)).toEqual([a]);
    expect(s.active).toBe(a);
    // close all leaves a fresh tab
    s = closeTabs(
      s,
      s.tabs.map((x) => x.id),
      T,
    );
    expect(s.tabs).toHaveLength(1);
    expect(currentView(s)).toEqual(T);
    expect(closeTabs(s, ["nope"], A)).toBe(s);
  });

  it("closing the active tab picks the nearest survivor, right first", () => {
    let s = initTabs<V>(A);
    const a = s.active;
    s = navigate(s, T, true);
    const t = s.active;
    s = navigate(s, F("x.md"), true);
    const x = s.active;
    s = { ...s, active: t };
    expect(closeTabs(s, [t], A).active).toBe(x);
    expect(closeTabs(s, [t, x], A).active).toBe(a);
  });

  it("duplicates a tab with its history, right after it", () => {
    let s = initTabs<V>(A);
    s = navigate(s, T);
    const a = s.active;
    s = navigate(s, F("x.md"), true);
    s = duplicateTab(s, a);
    expect(s.tabs).toHaveLength(3);
    expect(s.tabs[1].id).toBe(s.active);
    expect(activeTab(s).history).toEqual([A, T]);
    expect(currentView(s)).toEqual(T);
    expect(s.active).not.toBe(a);
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
