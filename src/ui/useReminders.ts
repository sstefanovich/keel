import { useEffect, useRef } from "react";
import { formatTime, hhmm, today } from "../core/dates";
import { Hold } from "../core/hold";
import { basename } from "../core/parse";
import { ensureNotificationPermission, notifyReminder, onReminderAction, showMainWindow } from "../lib/platform";

const CHECK_MS = 20_000;
/** Reminders missed while Keel wasn't running still fire if they're at most this late. */
const GRACE_MIN = 15;
const SNOOZE_KEY = "keel.snoozed";

const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

function firedKey(date: string) {
  return `keel.fired.${date}`;
}

function loadFired(date: string): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(firedKey(date)) ?? "[]"));
  } catch {
    return new Set();
  }
}

/** A reminder as it was shown, so it can be shown again after a snooze or opened from a click. */
interface Shown {
  id: string;
  title: string;
  body: string;
  file: string;
  line: number;
}

interface Snoozed extends Shown {
  /** When to show it again (ms) */
  at: number;
}

function loadSnoozed(): Snoozed[] {
  try {
    const v = JSON.parse(localStorage.getItem(SNOOZE_KEY) ?? "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function saveSnoozed(list: Snoozed[]) {
  try {
    localStorage.setItem(SNOOZE_KEY, JSON.stringify(list));
  } catch {
    // snoozes just won't survive a restart
  }
}

/**
 * Sends a notification when each of today's reminders comes due. On Windows it has Snooze buttons
 * (10 minutes / 1 hour); clicking the notification opens the file the reminder lives in.
 */
export function useReminders(hold: Hold, openFile: (path: string, line?: number) => void) {
  const shown = useRef(new Map<string, Shown>());
  const open = useRef(openFile);
  open.current = openFile;

  useEffect(() => {
    void ensureNotificationPermission();
    // forget fired sets from previous days
    try {
      for (const k of Object.keys(localStorage)) if (k.startsWith("keel.fired.") && k !== firedKey(today())) localStorage.removeItem(k);
    } catch {
      // ignore
    }

    const show = (s: Shown) => {
      shown.current.set(s.id, s);
      void notifyReminder(s.id, s.title, s.body);
    };

    const check = () => {
      const date = today();
      const now = minutes(hhmm(new Date()));
      const fired = loadFired(date);
      let changed = false;
      for (const r of hold.remindersOn(date)) {
        const due = minutes(r.rule.time);
        const key = `${r.file}|${r.text}|${r.rule.time}`;
        if (due > now || now - due > GRACE_MIN || fired.has(key)) continue;
        fired.add(key);
        changed = true;
        const where = r.file === "reminders.md" ? "" : ` · ${basename(r.file)}`;
        show({ id: key, title: r.text, body: `Keel · ${formatTime(r.rule.time)}${where}`, file: r.file, line: r.line });
      }
      if (changed) {
        try {
          localStorage.setItem(firedKey(date), JSON.stringify([...fired]));
        } catch {
          // ignore
        }
      }
      // snoozed ones that are due again
      const snoozed = loadSnoozed();
      const due = snoozed.filter((s) => s.at <= Date.now());
      if (due.length) {
        saveSnoozed(snoozed.filter((s) => s.at > Date.now()));
        for (const { at: _at, ...s } of due) show({ ...s, body: `${s.body} · snoozed` });
      }
    };
    check();
    const id = window.setInterval(check, CHECK_MS);

    const unAction = onReminderAction((key, action) => {
      const s = shown.current.get(key);
      if (!s) return;
      const snooze = /^snooze:(\d+)$/.exec(action);
      if (snooze) {
        const mins = Number(snooze[1]);
        saveSnoozed([...loadSnoozed().filter((x) => x.id !== key), { ...s, body: s.body.replace(/ · snoozed$/, ""), at: Date.now() + mins * 60_000 }]);
      } else if (action === "open") {
        void showMainWindow();
        open.current(s.file, s.line);
      }
    });

    return () => {
      window.clearInterval(id);
      unAction();
    };
  }, [hold]);
}
