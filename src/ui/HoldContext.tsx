import { ReactNode, createContext, useCallback, useContext, useEffect, useState } from "react";
import { Hold } from "../core/hold";
import { isCaptureWindow } from "../lib/platform";
import { useSpace } from "./space";

interface HoldCtx {
  hold: Hold;
  dir: string;
  /** Increments whenever the index changes; read it to re-render on changes. */
  version: number;
  bump: () => void;
  reportError: (e: unknown) => void;
  toast: (msg: string) => void;
  /** Client key everything is narrowed to, or undefined for all clients */
  focus?: string;
  setFocus: (client?: string) => void;
}

function loadFocus(): string | undefined {
  try {
    return localStorage.getItem("keel.focus") || undefined;
  } catch {
    return undefined;
  }
}

const Ctx = createContext<HoldCtx | null>(null);

export function useHold(): HoldCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useHold outside HoldProvider");
  return c;
}

const POLL_MS = 3000;

export function HoldProvider({ hold, dir, children }: { hold: Hold; dir: string; children: ReactNode }) {
  const [version, setVersion] = useState(0);
  const [toasts, setToasts] = useState<{ id: number; msg: string; error?: boolean }[]>([]);
  const bump = useCallback(() => setVersion((v) => v + 1), []);
  const [focus, setFocusState] = useState<string | undefined>(loadFocus);
  const setFocus = useCallback((client?: string) => {
    setFocusState(client);
    try {
      if (client) localStorage.setItem("keel.focus", client);
      else localStorage.removeItem("keel.focus");
    } catch {
      // focus just won't survive a restart
    }
  }, []);
  // forget a focus whose client file was deleted
  const focusValid = !focus || hold.clients().has(focus);
  // clients are work: in personal mode nothing is focused (the choice comes back with work mode)
  const space = useSpace();

  const push = useCallback((msg: string, error = false) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, msg, error }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), error ? 6000 : 2500);
  }, []);
  const reportError = useCallback(
    (e: unknown) => {
      console.error(e);
      push(e instanceof Error ? e.message : String(e), true);
    },
    [push],
  );

  // pick up changes made by other programs (another editor, sync tools)
  useEffect(() => {
    let busy = false;
    const tick = async () => {
      // the capture window sits hidden most of the time and re-reads when it opens: no polling there
      if (busy || document.hidden || isCaptureWindow) return;
      busy = true;
      try {
        if (await hold.reindex()) bump();
      } catch (e) {
        console.error(e);
      } finally {
        busy = false;
      }
    };
    const id = window.setInterval(tick, POLL_MS);
    window.addEventListener("focus", tick);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("focus", tick);
    };
  }, [hold, bump]);

  return (
    <Ctx.Provider value={{ hold, dir, version, bump, reportError, toast: push, focus: focusValid && space === "work" ? focus : undefined, setFocus }}>
      {children}
      <div className="toasts" role="status">
        {toasts.map((t) => (
          <div key={t.id} className={`toast${t.error ? " toast-error" : ""}`}>
            {t.msg}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
