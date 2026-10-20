import { useEffect } from "react";
import { formatTime, hhmm, today } from "../core/dates";
import { Hold } from "../core/hold";
import { basename } from "../core/parse";
import { ensureNotificationPermission, notify } from "../lib/platform";

const CHECK_MS = 20_000;
/** Reminders missed while Keel wasn't running still fire if they're at most this late. */
const GRACE_MIN = 15;

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

/** Sends a desktop notification when each of today's reminders comes due. */
export function useReminders(hold: Hold) {
  useEffect(() => {
    void ensureNotificationPermission();
    // forget fired sets from previous days
    try {
      for (const k of Object.keys(localStorage)) if (k.startsWith("keel.fired.") && k !== firedKey(today())) localStorage.removeItem(k);
    } catch {
      // ignore
    }

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
        void notify(r.text, `Keel · ${formatTime(r.rule.time)}${where}`);
      }
      if (changed) {
        try {
          localStorage.setItem(firedKey(date), JSON.stringify([...fired]));
        } catch {
          // ignore
        }
      }
    };
    check();
    const id = window.setInterval(check, CHECK_MS);
    return () => window.clearInterval(id);
  }, [hold]);
}
