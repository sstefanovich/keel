import { FitAddon } from "@xterm/addon-fit";
import { ITheme, Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useEffect, useRef, useState } from "react";
import { copyText, isTauri } from "../lib/platform";
import { useHold } from "./HoldContext";
import { Theme, useTheme } from "./theme";

type Status = "starting" | "running" | "exited" | "missing" | "error" | "browser";

const THEMES: Record<Theme, ITheme> = {
  dark: { background: "#0f1319", foreground: "#e3e8ef", cursor: "#5aa6d6", cursorAccent: "#0f1319", selectionBackground: "#2a4a66" },
  light: { background: "#ffffff", foreground: "#1b2330", cursor: "#1f5f8b", cursorAccent: "#ffffff", selectionBackground: "#cfe0ee" },
};

const HEIGHT_KEY = "keel.claudeHeight";

function loadHeight(): number {
  try {
    return Math.max(160, Number(localStorage.getItem(HEIGHT_KEY)) || 340);
  } catch {
    return 340;
  }
}

/** Claude's spark, drawn as simple rays (not the official logo). */
export function ClaudeIcon({ size = 18 }: { size?: number }) {
  const rays = [0, 45, 90, 135, 180, 225, 270, 315];
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <g stroke="#D97757" strokeWidth="2.4" strokeLinecap="round">
        {rays.map((a) => {
          const r = (a * Math.PI) / 180;
          const long = a % 90 === 0 ? 10 : 8.5;
          return <line key={a} x1={12 + Math.cos(r) * 3} y1={12 + Math.sin(r) * 3} x2={12 + Math.cos(r) * long} y2={12 + Math.sin(r) * long} />;
        })}
      </g>
    </svg>
  );
}

/**
 * Claude Code running in a terminal docked under the main view, in the Hold folder: the full
 * terminal app, for what the chat sidebar can't do (/login, /mcp approvals, /config).
 * Mounted once and only hidden when closed, so the conversation survives toggling.
 */
export function ClaudePanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { dir } = useHold();
  const { theme } = useTheme();
  const host = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const idRef = useRef<number | undefined>(undefined);
  // Output can arrive before pty_spawn has returned the session id. Windows asks for the cursor
  // position at startup and waits for xterm's reply, so dropping that output would hang the terminal.
  const early = useRef(new Map<number, string[]>());
  const statusRef = useRef<Status>("starting");
  const [status, setStatusState] = useState<Status>(isTauri ? "starting" : "browser");
  const [error, setError] = useState("");
  const [height, setHeight] = useState(loadHeight);
  const setStatus = (s: Status) => {
    statusRef.current = s;
    setStatusState(s);
  };

  const start = async () => {
    const term = termRef.current;
    if (!term || !isTauri) return;
    const { invoke } = await import("@tauri-apps/api/core");
    setStatus("starting");
    try {
      if (!(await invoke<string | null>("claude_path"))) return setStatus("missing");
      fitRef.current?.fit();
      const id = await invoke<number>("pty_spawn", { cwd: dir, cols: term.cols, rows: term.rows });
      idRef.current = id;
      early.current.get(id)?.forEach((d) => term.write(d));
      early.current.clear();
      setStatus("running");
      term.focus();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
    }
  };

  const stop = async () => {
    const id = idRef.current;
    idRef.current = undefined;
    if (id !== undefined && isTauri) {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("pty_kill", { id }).catch(() => {});
    }
  };

  const restart = async () => {
    await stop();
    termRef.current?.reset();
    await start();
  };

  // create the terminal and the Claude session once
  useEffect(() => {
    if (!host.current) return;
    const term = new Terminal({
      fontFamily: '"Cascadia Mono", "Cascadia Code", Consolas, "SF Mono", Menlo, monospace',
      fontSize: 13,
      cursorBlink: true,
      allowProposedApi: true,
      scrollback: 5000,
      theme: THEMES[theme],
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host.current);
    termRef.current = term;
    fitRef.current = fit;

    // Ctrl+C copies when text is selected (otherwise it interrupts Claude, as usual);
    // Ctrl+V pastes through the browser's paste event instead of sending ^V
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== "keydown") return true;
      if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === "c" && term.hasSelection()) {
        void copyText(term.getSelection());
        term.clearSelection();
        return false;
      }
      if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === "v") return false;
      return true;
    });

    const unlisten: (() => void)[] = [];
    let disposed = false;
    if (isTauri) {
      (async () => {
        const { listen } = await import("@tauri-apps/api/event");
        const { invoke } = await import("@tauri-apps/api/core");
        const u1 = await listen<{ id: number; data: string }>("pty-output", (e) => {
          const { id, data } = e.payload;
          if (id === idRef.current) term.write(data);
          else if (idRef.current === undefined && statusRef.current === "starting") early.current.set(id, [...(early.current.get(id) ?? []), data]);
        });
        const u2 = await listen<{ id: number }>("pty-exit", (e) => {
          if (e.payload.id !== idRef.current) return;
          idRef.current = undefined;
          setStatus("exited");
          term.write("\r\n\x1b[2m[Claude exited. Press Enter to start it again.]\x1b[0m\r\n");
        });
        unlisten.push(u1, u2);
        if (disposed) return unlisten.forEach((u) => u());
        term.onData((data) => {
          const id = idRef.current;
          if (id !== undefined) void invoke("pty_write", { id, data });
          else if (statusRef.current === "exited" && data === "\r") void start();
        });
        await start();
      })();
    }

    const ro = new ResizeObserver(async () => {
      if (!host.current?.offsetHeight) return; // hidden
      fit.fit();
      const id = idRef.current;
      if (id !== undefined && isTauri) {
        const { invoke } = await import("@tauri-apps/api/core");
        void invoke("pty_resize", { id, cols: term.cols, rows: term.rows }).catch(() => {});
      }
    });
    ro.observe(host.current);

    return () => {
      disposed = true;
      ro.disconnect();
      unlisten.forEach((u) => u());
      void stop();
      term.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (termRef.current) termRef.current.options.theme = THEMES[theme];
  }, [theme]);

  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => {
      fitRef.current?.fit();
      termRef.current?.focus();
    });
  }, [open, height]);

  // drag the top edge to resize
  const startDrag = (e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = height;
    let h = startH;
    const move = (ev: MouseEvent) => {
      h = Math.min(Math.max(160, startH + (startY - ev.clientY)), window.innerHeight - 120);
      setHeight(h);
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      try {
        localStorage.setItem(HEIGHT_KEY, String(Math.round(h)));
      } catch {
        // ignore
      }
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  return (
    <section className={`claude-panel${open ? "" : " hidden"}`} style={{ height }} aria-label="Claude" aria-hidden={!open}>
      <div className="claude-resize" onMouseDown={startDrag} title="Drag to resize" />
      <header className="claude-head">
        <ClaudeIcon size={16} />
        <span className="claude-title">Claude</span>
        <span className="muted small claude-cwd" title={dir}>
          in {dir}
        </span>
        <span className="spacer" />
        {(status === "running" || status === "exited" || status === "error") && (
          <button className="ghost small" onClick={restart} title="Start a fresh Claude session">
            Restart
          </button>
        )}
        <button className="icon-btn" onClick={onClose} aria-label="Hide Claude" title="Hide (Ctrl+`). Claude keeps running">
          ×
        </button>
      </header>
      <div className="claude-body">
        <div className="claude-term" ref={host} />
        {status === "missing" && (
          <div className="claude-overlay">
            <p>
              <b>Claude Code isn't installed.</b> Install it in PowerShell, run <code>claude</code> once to sign in with your Claude
              account, then click Try again.
            </p>
            <pre>irm https://claude.ai/install.ps1 | iex</pre>
            <button onClick={start}>Try again</button>
          </div>
        )}
        {status === "error" && (
          <div className="claude-overlay">
            <p>
              <b>Couldn't start Claude:</b> {error}
            </p>
            <button onClick={start}>Try again</button>
          </div>
        )}
        {status === "browser" && (
          <div className="claude-overlay">
            <p>The Claude terminal works in the Keel desktop app, not in a browser preview.</p>
          </div>
        )}
      </div>
    </section>
  );
}
