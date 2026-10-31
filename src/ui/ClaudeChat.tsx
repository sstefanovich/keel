import { ArrowUp, Check, ChevronRight, CircleAlert, FileText, LoaderCircle, Square, SquarePen, SquareTerminal, X } from "lucide-react";
import { KeyboardEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ChatCommand,
  ChatItem,
  ChatQuestion,
  ChatState,
  addNotice,
  addUserMessage,
  allowLine,
  answerItem,
  applyMessage,
  controlLine,
  denyLine,
  emptyChat,
  endSession,
  relativeToHold,
  toolLabel,
  toolSummary,
  unsupportedLine,
  userLine,
} from "../core/claudeChat";
import { isTauri, openUrl } from "../lib/platform";
import { ChatMarkdown } from "./ChatMarkdown";
import { ClaudeIcon } from "./ClaudePanel";
import { onClaudePrompt, takeClaudePrompts } from "./claudeBridge";
import { useHold } from "./HoldContext";
import { useNav } from "./nav";
import { WindowControls } from "./WindowControls";

type Status = "starting" | "ready" | "exited" | "missing" | "error" | "browser";

const WIDTH_KEY = "keel.claudeChatWidth";
const MIN_WIDTH = 300;

function loadWidth(): number {
  try {
    return Math.max(MIN_WIDTH, Number(localStorage.getItem(WIDTH_KEY)) || 400);
  } catch {
    return 400;
  }
}

/** Tools that change files in the Hold: Keel re-reads it when one finishes. */
const WRITES = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit", "Bash", "PowerShell"]);

const SUGGESTIONS = ["What's on my plate today?", "Summarise this week's logs", "Which tasks are overdue?", "Tidy up today's log"];

/**
 * Claude Code as a chat in a sidebar on the right, working in the Hold folder. Runs Claude headless
 * (stream-json), so replies, tool calls, permission prompts and questions are drawn as chat.
 * Mounted once and only hidden when closed, so the conversation survives toggling.
 */
export function ClaudeChat({ open, onClose, onTerminal }: { open: boolean; onClose: () => void; onTerminal: () => void }) {
  const { hold, dir, bump, reportError } = useHold();
  const nav = useNav();
  const [chat, setChatState] = useState<ChatState>(emptyChat);
  const chatRef = useRef(chat);
  const setChat = (fn: (s: ChatState) => ChatState) => {
    chatRef.current = fn(chatRef.current);
    setChatState(chatRef.current);
  };
  const [status, setStatusState] = useState<Status>(isTauri ? "starting" : "browser");
  const statusRef = useRef(status);
  const setStatus = (s: Status) => {
    statusRef.current = s;
    setStatusState(s);
  };
  const [error, setError] = useState("");
  const [width, setWidth] = useState(loadWidth);
  const [draft, setDraft] = useState("");
  const [attach, setAttach] = useState(false);
  const idRef = useRef<number | undefined>(undefined);
  // a session we killed on purpose: its exit isn't an error
  const killed = useRef(new Set<number>());
  const starting = useRef<Promise<number | undefined> | null>(null);
  const reqSeq = useRef(0);
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const stick = useRef(true);

  const invoke = async <T,>(cmd: string, args: Record<string, unknown>) => (await import("@tauri-apps/api/core")).invoke<T>(cmd, args);

  /** Start Claude (once), optionally continuing an earlier session; resolves to its id. */
  const start = (resume?: string): Promise<number | undefined> => {
    if (!isTauri) return Promise.resolve(undefined);
    if (idRef.current !== undefined) return Promise.resolve(idRef.current);
    if (starting.current) return starting.current;
    setStatus("starting");
    starting.current = (async () => {
      try {
        if (!(await invoke<string | null>("claude_path", {}))) {
          setStatus("missing");
          return undefined;
        }
        const id = await invoke<number>("chat_spawn", { cwd: dir, resume: resume ?? null });
        idRef.current = id;
        setStatus("ready");
        await invoke("chat_send", { id, line: controlLine(`init-${++reqSeq.current}`, "initialize") });
        return id;
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setStatus("error");
        return undefined;
      } finally {
        starting.current = null;
      }
    })();
    return starting.current;
  };

  const stop = async () => {
    const id = idRef.current;
    idRef.current = undefined;
    if (id !== undefined) {
      killed.current.add(id);
      await invoke("chat_kill", { id }).catch(() => {});
    }
  };

  /** Write a line to Claude, starting it again (and picking up the conversation) if it had exited. */
  const write = async (line: string) => {
    const id = idRef.current ?? (await start(chatRef.current.sessionId));
    if (id === undefined) return false;
    try {
      await invoke("chat_send", { id, line });
      return true;
    } catch (e) {
      reportError(e);
      return false;
    }
  };

  const send = async (raw: string) => {
    const text = raw.trim();
    if (!text) return;
    const current = nav.view.kind === "file" ? nav.view.path : undefined;
    const prompt = attach && current && !text.startsWith("/") ? `${text}\n\n(I'm looking at \`${current}\` in Keel.)` : text;
    // typing while Claude waits on a permission prompt answers it: "no, do this instead"
    const pending = chatRef.current.items.filter((it) => it.kind === "permission" && !it.answer);
    stick.current = true;
    if (pending.length) {
      setChat((s) => {
        let next = addUserMessage(s, text);
        pending.forEach((p) => (next = answerItem(next, p.id, "denied")));
        return next;
      });
      for (const p of pending) await write(denyLine(p.id, `The owner declined and said: ${prompt}`));
      return;
    }
    setChat((s) => addUserMessage(s, text));
    if (!(await write(userLine(prompt)))) setChat(endSession);
  };

  const interrupt = () => void write(controlLine(`int-${++reqSeq.current}`, "interrupt"));

  const newChat = async () => {
    await stop();
    setChat(() => emptyChat());
    setError("");
    await start();
    input.current?.focus();
  };

  // listen to Claude, and start the first session
  useEffect(() => {
    if (!isTauri) return;
    const unlisten: (() => void)[] = [];
    let disposed = false;
    (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      const u1 = await listen<{ id: number; line: string }>("chat-line", (e) => {
        if (e.payload.id !== idRef.current) return;
        let m;
        try {
          m = JSON.parse(e.payload.line);
        } catch {
          return; // not a message (a stray log line)
        }
        if (m.type === "control_request" && m.request?.subtype !== "can_use_tool") {
          void write(unsupportedLine(m.request_id));
          return;
        }
        const before = chatRef.current;
        setChat((s) => applyMessage(s, m));
        // Claude changed files: show them now rather than at the next poll
        if (m.type === "user" && Array.isArray(m.message?.content)) {
          const changed = m.message.content.some((b: { type?: string; tool_use_id?: string }) => {
            const tool = before.items.find((it) => it.id === b.tool_use_id);
            return b.type === "tool_result" && tool?.kind === "tool" && WRITES.has(tool.name);
          });
          if (changed) void hold.reindex().then((c) => c && bump()).catch(() => {});
        }
      });
      const u2 = await listen<{ id: number; error: string }>("chat-exit", (e) => {
        const { id, error } = e.payload;
        if (killed.current.delete(id) || id !== idRef.current) return;
        idRef.current = undefined;
        setStatus("exited");
        setChat((s) => {
          const ended = endSession(s);
          return error ? addNotice(ended, `Claude stopped: ${error.split("\n").slice(-3).join(" ")}`, "error") : ended;
        });
      });
      unlisten.push(u1, u2);
      if (disposed) return unlisten.forEach((u) => u());
      await start();
    })();
    return () => {
      disposed = true;
      unlisten.forEach((u) => u());
      void stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // prompts from elsewhere: "? …" in quick capture, the Timesheet's Claude buttons
  useEffect(() => {
    const deliver = () => {
      for (const p of takeClaudePrompts()) void send(p);
    };
    deliver();
    return onClaudePrompt(deliver);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (open) requestAnimationFrame(() => input.current?.focus());
  }, [open]);

  // keep the newest message in view, unless the owner scrolled up to read
  useLayoutEffect(() => {
    const el = list.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [chat.items, chat.busy]);
  const onScroll = () => {
    const el = list.current;
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };

  // drag the left edge to resize
  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    let w = width;
    const move = (ev: MouseEvent) => {
      w = Math.min(Math.max(MIN_WIDTH, window.innerWidth - ev.clientX), Math.round(window.innerWidth * 0.6));
      setWidth(w);
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      document.body.classList.remove("resizing");
      try {
        localStorage.setItem(WIDTH_KEY, String(w));
      } catch {
        // ignore
      }
    };
    document.body.classList.add("resizing");
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  /** A path Claude mentioned: open it in Keel when it's in the Hold, otherwise in the browser. */
  const holdPath = (target: string): string | undefined => {
    const rel = relativeToHold(target.replace(/^\.\//, ""), dir).replace(/\\/g, "/");
    if (hold.get(rel)) return rel;
    return /^https?:/i.test(target) ? undefined : hold.resolveLink(rel.replace(/\.md$/i, ""));
  };
  const openTarget = (target: string) => {
    const path = holdPath(target);
    if (path) nav.openFile(path);
    else if (/^(https?|mailto):/i.test(target)) void openUrl(target);
  };
  const isPath = (s: string) => /[\\/]|\.md$/i.test(s) && !/\s/.test(s) && !!holdPath(s);

  const answerPermission = (item: Extract<ChatItem, { kind: "permission" }>, how: "allowed" | "always" | "denied") => {
    setChat((s) => answerItem(s, item.id, how));
    void write(how === "denied" ? denyLine(item.id, "The owner said no.") : allowLine(item.id, item.input, how === "always" ? item.suggestions : undefined));
    input.current?.focus();
  };

  const answerQuestion = (item: Extract<ChatItem, { kind: "question" }>, answers: Record<string, string>) => {
    setChat((s) => answerItem(s, item.id, "answered", answers));
    void write(allowLine(item.id, { ...item.input, answers }));
  };

  const busy = chat.busy || status === "starting";
  const waiting = chat.items.some((it) => (it.kind === "permission" || it.kind === "question") && !it.answer);
  const last = chat.items[chat.items.length - 1];
  const thinking = chat.busy && !waiting && !(last?.kind === "text" && last.streaming);
  const current = nav.view.kind === "file" ? nav.view.path : undefined;

  return (
    <aside className={`claude-chat${open ? "" : " hidden"}`} style={{ width }} aria-label="Claude" aria-hidden={!open}>
      <div className="chat-resize" onMouseDown={startResize} title="Drag to resize" aria-hidden="true" />
      <header className="chat-head">
        <ClaudeIcon size={16} />
        <span className="chat-title">Claude</span>
        {chat.model && <span className="chat-model muted small">{chat.model.replace(/^claude-/, "")}</span>}
        <span className="chat-drag" data-tauri-drag-region />
        <button className="icon-btn" onClick={() => void newChat()} title="New chat" aria-label="New chat" disabled={status === "browser"}>
          <SquarePen size={15} />
        </button>
        <button className="icon-btn" onClick={onTerminal} title="Open Claude in a terminal (Ctrl+Shift+`), for /login, /mcp and other terminal-only commands" aria-label="Claude terminal">
          <SquareTerminal size={15} />
        </button>
        <button className="icon-btn" onClick={onClose} aria-label="Hide Claude" title="Hide (Ctrl+`). Claude keeps working">
          <X size={16} />
        </button>
        {open && <WindowControls />}
      </header>

      <div className="chat-list" ref={list} onScroll={onScroll}>
        {!chat.items.length && status !== "missing" && status !== "browser" && status !== "error" && (
          <div className="chat-empty">
            <ClaudeIcon size={30} />
            <p>Ask Claude about your logs, tasks, hours and notes. It works right in your Hold and asks before changing anything.</p>
            <div className="chat-suggestions">
              {SUGGESTIONS.map((s) => (
                <button key={s} className="chat-chip" onClick={() => void send(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {chat.items.map((it) => (
          <Item key={it.id} item={it} dir={dir} onLink={openTarget} isPath={isPath} onPermission={answerPermission} onQuestion={answerQuestion} />
        ))}
        {thinking && (
          <div className="chat-working muted small">
            <LoaderCircle size={14} className="spin" aria-hidden="true" /> Working…
          </div>
        )}
        {status === "missing" && (
          <div className="chat-notice">
            <p>
              <b>Claude Code isn't installed.</b> Install it in PowerShell, run <code>claude</code> once to sign in with your Claude account, then
              click Try again.
            </p>
            <pre>irm https://claude.ai/install.ps1 | iex</pre>
            <button onClick={() => void start()}>Try again</button>
          </div>
        )}
        {status === "error" && (
          <div className="chat-notice">
            <p>
              <b>Couldn't start Claude:</b> {error}
            </p>
            <button onClick={() => void start()}>Try again</button>
          </div>
        )}
        {status === "browser" && (
          <div className="chat-notice">
            <p>Claude works in the Keel desktop app, not in a browser preview.</p>
          </div>
        )}
      </div>

      <Composer
        inputRef={input}
        draft={draft}
        setDraft={setDraft}
        commands={chat.commands}
        busy={busy && !waiting}
        waiting={waiting}
        disabled={status === "missing" || status === "browser"}
        onSend={(t) => {
          setDraft("");
          void send(t);
        }}
        onStop={interrupt}
        context={
          current && (
            <button
              className={`chat-context${attach ? " on" : ""}`}
              onClick={() => setAttach((a) => !a)}
              aria-pressed={attach}
              title={attach ? "Claude is told which note you're looking at. Click to stop" : "Tell Claude which note you're looking at"}
            >
              <FileText size={12} aria-hidden="true" />
              {hold.get(current)?.title ?? current}
            </button>
          )
        }
      />
    </aside>
  );
}

function Item({
  item,
  dir,
  onLink,
  isPath,
  onPermission,
  onQuestion,
}: {
  item: ChatItem;
  dir: string;
  onLink: (t: string) => void;
  isPath: (s: string) => boolean;
  onPermission: (it: Extract<ChatItem, { kind: "permission" }>, how: "allowed" | "always" | "denied") => void;
  onQuestion: (it: Extract<ChatItem, { kind: "question" }>, answers: Record<string, string>) => void;
}) {
  switch (item.kind) {
    case "user":
      return <div className="chat-msg chat-user">{item.text}</div>;
    case "text":
      return (
        <div className={`chat-msg chat-claude${item.streaming ? " streaming" : ""}`}>
          <ChatMarkdown text={item.text} onLink={onLink} isPath={isPath} />
        </div>
      );
    case "notice":
      return (
        <div className={`chat-note ${item.tone}`}>
          {item.tone === "error" && <CircleAlert size={13} aria-hidden="true" />} {item.text}
        </div>
      );
    case "tool":
      return <ToolCall item={item} dir={dir} onLink={onLink} isPath={isPath} />;
    case "permission":
      return <Permission item={item} dir={dir} onAnswer={(how) => onPermission(item, how)} />;
    case "question":
      return <Question item={item} onAnswer={(a) => onQuestion(item, a)} />;
  }
}

function ToolCall({ item, dir, onLink, isPath }: { item: Extract<ChatItem, { kind: "tool" }>; dir: string; onLink: (t: string) => void; isPath: (s: string) => boolean }) {
  const summary = toolSummary(item.name, item.input, dir);
  const file = typeof item.input.file_path === "string" && isPath(item.input.file_path) ? item.input.file_path : undefined;
  return (
    <details className={`chat-tool ${item.status}`}>
      <summary>
        <ChevronRight size={13} className="chev" aria-hidden="true" />
        {item.status === "running" ? (
          <LoaderCircle size={13} className="spin" aria-label="Running" />
        ) : item.status === "error" ? (
          <CircleAlert size={13} aria-label="Failed" />
        ) : (
          <Check size={13} aria-label="Done" />
        )}
        <span className="tool-name">{toolLabel(item.name)}</span>
        {file ? (
          <button
            className="chat-path tool-sum"
            onClick={(e) => {
              e.preventDefault();
              onLink(file);
            }}
            title="Open in Keel"
          >
            {summary}
          </button>
        ) : (
          <span className="tool-sum" title={summary}>
            {summary}
          </span>
        )}
      </summary>
      <ToolInput name={item.name} input={item.input} />
      {item.result && <pre className="tool-result">{clip(item.result, 4000)}</pre>}
    </details>
  );
}

/** What a tool call will do, for the permission card and the expanded tool call. */
function ToolInput({ name, input }: { name: string; input: Record<string, unknown> }) {
  const s = (k: string) => (typeof input[k] === "string" ? (input[k] as string) : undefined);
  if ((name === "Bash" || name === "PowerShell") && s("command")) return <pre className="tool-input">{s("command")}</pre>;
  if (name === "Edit" && s("old_string") !== undefined)
    return (
      <div className="tool-diff">
        <pre className="del">{clip(s("old_string")!, 1500)}</pre>
        <pre className="add">{clip(s("new_string") ?? "", 1500)}</pre>
      </div>
    );
  if (name === "Write" && s("content") !== undefined) return <pre className="tool-input add">{clip(s("content")!, 2000)}</pre>;
  const rest = Object.fromEntries(Object.entries(input).filter(([k]) => k !== "description"));
  if (!Object.keys(rest).length) return null;
  return <pre className="tool-input">{clip(JSON.stringify(rest, null, 2), 2000)}</pre>;
}

function Permission({ item, dir, onAnswer }: { item: Extract<ChatItem, { kind: "permission" }>; dir: string; onAnswer: (how: "allowed" | "always" | "denied") => void }) {
  const summary = toolSummary(item.tool, item.input, dir);
  const outcome: Record<string, string> = { allowed: "Allowed", always: "Allowed for this chat", denied: "Declined", cancelled: "No longer needed" };
  return (
    <div className={`chat-card permission${item.answer ? " answered" : ""}`}>
      <div className="card-title">
        Claude wants to <b>{toolLabel(item.tool).toLowerCase()}</b>
        {summary && <span className="tool-sum"> {summary}</span>}
      </div>
      <ToolInput name={item.tool} input={item.input} />
      {item.answer ? (
        <div className={`card-outcome ${item.answer}`}>{outcome[item.answer]}</div>
      ) : (
        <div className="card-actions">
          <button className="primary" onClick={() => onAnswer("allowed")} autoFocus>
            Allow
          </button>
          {item.suggestions && (
            <button onClick={() => onAnswer("always")} title="Don't ask again for this kind of action in this chat">
              Always allow
            </button>
          )}
          <button className="ghost" onClick={() => onAnswer("denied")}>
            Deny
          </button>
          <span className="muted small card-hint">or type what to do instead</span>
        </div>
      )}
    </div>
  );
}

function Question({ item, onAnswer }: { item: Extract<ChatItem, { kind: "question" }>; onAnswer: (answers: Record<string, string>) => void }) {
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const [other, setOther] = useState<Record<string, string>>({});
  const answers = (p: Record<string, string[]>, o: Record<string, string>) =>
    Object.fromEntries(item.questions.map((q) => [q.question, [...(p[q.question] ?? []), ...(o[q.question]?.trim() ? [o[q.question].trim()] : [])].join(", ")]));
  const complete = (a: Record<string, string>) => item.questions.every((q) => a[q.question]);
  const choose = (q: ChatQuestion, label: string) => {
    const cur = picked[q.question] ?? [];
    const next = { ...picked, [q.question]: q.multiSelect ? (cur.includes(label) ? cur.filter((l) => l !== label) : [...cur, label]) : [label] };
    setPicked(next);
    // a single question with single choice: answer on click
    if (!q.multiSelect && item.questions.length === 1) onAnswer(answers(next, {}));
  };
  if (item.answer) {
    return (
      <div className="chat-card question answered">
        {item.questions.map((q) => (
          <div key={q.question}>
            <div className="card-title">{q.question}</div>
            <div className={`card-outcome ${item.answer}`}>{item.picked?.[q.question] ?? (item.answer === "cancelled" ? "No longer needed" : "")}</div>
          </div>
        ))}
      </div>
    );
  }
  const all = answers(picked, other);
  const instant = item.questions.length === 1 && !item.questions[0].multiSelect;
  return (
    <div className="chat-card question">
      {item.questions.map((q) => (
        <fieldset key={q.question}>
          <legend className="card-title">{q.question}</legend>
          <div className="choices">
            {q.options.map((o) => {
              const on = (picked[q.question] ?? []).includes(o.label);
              return (
                <button key={o.label} className={`choice${on ? " on" : ""}`} aria-pressed={on} onClick={() => choose(q, o.label)}>
                  <span className="choice-label">{o.label}</span>
                  {o.description && <span className="choice-desc">{o.description}</span>}
                </button>
              );
            })}
          </div>
          <input
            className="choice-other"
            placeholder="Something else…"
            value={other[q.question] ?? ""}
            onChange={(e) => setOther({ ...other, [q.question]: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter" && complete(all)) onAnswer(all);
            }}
          />
        </fieldset>
      ))}
      {(!instant || other[item.questions[0].question]?.trim()) && (
        <div className="card-actions">
          <button className="primary" disabled={!complete(all)} onClick={() => onAnswer(all)}>
            Answer
          </button>
        </div>
      )}
    </div>
  );
}

/** The message box: Enter sends, Shift+Enter is a new line, "/" lists Claude's commands and skills. */
function Composer({
  inputRef,
  draft,
  setDraft,
  commands,
  busy,
  waiting,
  disabled,
  onSend,
  onStop,
  context,
}: {
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  draft: string;
  setDraft: (s: string) => void;
  commands: ChatCommand[];
  busy: boolean;
  waiting: boolean;
  disabled: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
  context: React.ReactNode;
}) {
  const [sel, setSel] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const slash = /^\/(\S*)$/.exec(draft);
  const matches = useMemo(() => {
    if (!slash) return [];
    const q = slash[1].toLowerCase();
    const name = (c: ChatCommand) => c.name.toLowerCase();
    // names that start with what's typed, then (from two letters on) names that contain it
    const starts = commands.filter((c) => name(c).startsWith(q));
    const within = q.length > 1 ? commands.filter((c) => !name(c).startsWith(q) && name(c).includes(q)) : [];
    return [...starts, ...within].slice(0, 8);
  }, [slash?.[1], commands]); // eslint-disable-line react-hooks/exhaustive-deps
  const menu = !dismissed && matches.length > 0;

  // grow with the text, up to a limit
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [draft, inputRef]);

  const pick = (c: ChatCommand) => {
    setDraft(`/${c.name} `);
    setSel(0);
    inputRef.current?.focus();
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (menu) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setSel((s) => (s + (e.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length);
        return;
      }
      if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
        e.preventDefault();
        pick(matches[Math.min(sel, matches.length - 1)]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setDismissed(true);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (!busy && draft.trim()) onSend(draft);
    }
  };

  return (
    <div className="chat-composer">
      {menu && (
        <ul className="slash-menu" role="listbox">
          {matches.map((c, i) => (
            <li key={c.name} role="option" aria-selected={i === sel} className={i === sel ? "on" : ""} onMouseDown={(e) => (e.preventDefault(), pick(c))} onMouseEnter={() => setSel(i)}>
              <span className="slash-name">
                /{c.name}
                {c.argumentHint && <span className="muted"> {c.argumentHint}</span>}
              </span>
              {c.description && <span className="slash-desc muted small">{c.description}</span>}
            </li>
          ))}
        </ul>
      )}
      <div className="composer-box">
        <textarea
          ref={inputRef}
          rows={1}
          value={draft}
          disabled={disabled}
          placeholder={waiting ? "Answer above, or type what to do instead…" : "Ask Claude…  ( / for commands )"}
          onChange={(e) => {
            setDraft(e.target.value);
            setDismissed(false);
            setSel(0);
          }}
          onKeyDown={onKey}
          aria-label="Message Claude"
        />
        <div className="composer-row">
          {context}
          <span className="spacer" />
          {busy ? (
            <button className="send stop" onClick={onStop} title="Stop Claude" aria-label="Stop">
              <Square size={12} fill="currentColor" />
            </button>
          ) : (
            <button className="send" onClick={() => onSend(draft)} disabled={disabled || !draft.trim()} title="Send (Enter)" aria-label="Send">
              <ArrowUp size={15} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function clip(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}\n… (${s.length - max} more characters)` : s;
}
