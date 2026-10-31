/**
 * The Claude chat sidebar's conversation, built from Claude Code's stream-json output
 * (`claude -p --output-format stream-json --include-partial-messages`). Pure, so it's testable:
 * the panel feeds each line Claude prints through `applyMessage` and draws `items`.
 */

export interface ChatCommand {
  name: string;
  description: string;
  argumentHint?: string;
}

export interface ChatOption {
  label: string;
  description?: string;
}

export interface ChatQuestion {
  question: string;
  header?: string;
  multiSelect?: boolean;
  options: ChatOption[];
}

export type ToolStatus = "running" | "done" | "error";

/** How a permission request or question ended. */
export type Answer = "allowed" | "always" | "denied" | "answered" | "cancelled";

export type ChatItem =
  | { kind: "user"; id: string; text: string }
  | { kind: "text"; id: string; text: string; streaming: boolean }
  | { kind: "tool"; id: string; name: string; input: Record<string, unknown>; status: ToolStatus; result?: string }
  | {
      kind: "permission";
      id: string;
      tool: string;
      input: Record<string, unknown>;
      description?: string;
      /** Rules Claude suggests for "always allow" (passed back as updatedPermissions) */
      suggestions?: unknown[];
      answer?: Answer;
    }
  | { kind: "question"; id: string; input: Record<string, unknown>; questions: ChatQuestion[]; answer?: Answer; picked?: Record<string, string> }
  | { kind: "notice"; id: string; text: string; tone: "info" | "error" };

export interface ChatState {
  items: ChatItem[];
  /** Claude is working on a turn */
  busy: boolean;
  sessionId?: string;
  model?: string;
  commands: ChatCommand[];
  /** Assistant message being streamed, and the item id of each of its text blocks by index */
  streaming?: { messageId: string; blocks: Record<number, string> };
}

export const emptyChat = (): ChatState => ({ items: [], busy: false, commands: [] });

// The stream is loosely typed JSON; read it defensively.
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

let seq = 0;
const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(seq++).toString(36)}`;

/** Text of a tool result, which is a string or a list of content blocks. */
export function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => (b && typeof b === "object" && (b as Json).type === "text" ? String((b as Json).text ?? "") : (b as Json)?.type === "image" ? "[image]" : ""))
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function update(items: ChatItem[], id: string, fn: (it: ChatItem) => ChatItem): ChatItem[] {
  const i = items.findIndex((x) => x.id === id);
  if (i < 0) return items;
  const next = items.slice();
  next[i] = fn(items[i]);
  return next;
}

/** The owner's own message, shown at once (Claude doesn't echo it back). */
export function addUserMessage(s: ChatState, text: string): ChatState {
  return { ...s, busy: true, items: [...s.items, { kind: "user", id: newId("u"), text }] };
}

export function addNotice(s: ChatState, text: string, tone: "info" | "error" = "info"): ChatState {
  return { ...s, items: [...s.items, { kind: "notice", id: newId("n"), text, tone }] };
}

/** Record the owner's answer to a permission request or question. */
export function answerItem(s: ChatState, id: string, answer: Answer, picked?: Record<string, string>): ChatState {
  return { ...s, items: update(s.items, id, (it) => (it.kind === "permission" || it.kind === "question" ? { ...it, answer, picked } : it)) };
}

/** The session ended: nothing is running any more and open requests can't be answered. */
export function endSession(s: ChatState): ChatState {
  return {
    ...s,
    busy: false,
    streaming: undefined,
    items: s.items.map((it) =>
      (it.kind === "permission" || it.kind === "question") && !it.answer
        ? { ...it, answer: "cancelled" }
        : it.kind === "tool" && it.status === "running"
          ? { ...it, status: "error" }
          : it.kind === "text" && it.streaming
            ? { ...it, streaming: false }
            : it,
    ),
  };
}

/** The reply to `initialize`: the slash commands and skills this session knows. */
function readCommands(list: unknown): ChatCommand[] {
  if (!Array.isArray(list)) return [];
  return list
    .map((c: Json) => (typeof c === "string" ? { name: c, description: "" } : { name: String(c?.name ?? ""), description: String(c?.description ?? ""), argumentHint: c?.argumentHint || undefined }))
    .filter((c) => c.name);
}

/** Fold one message from Claude into the conversation. */
export function applyMessage(s: ChatState, m: Json): ChatState {
  // a subagent's own messages: its tool call in the main conversation already stands for it
  if (m.parent_tool_use_id) return s;
  switch (m.type) {
    case "system":
      if (m.subtype === "init") {
        const names = readCommands(m.slash_commands);
        // keep the richer list from initialize (with descriptions) when there is one
        const commands = s.commands.length ? s.commands : names;
        return { ...s, sessionId: m.session_id ?? s.sessionId, model: m.model ?? s.model, commands };
      }
      if (m.subtype === "compact_boundary") return addNotice(s, "Earlier messages were summarised to make room.");
      return s;

    case "control_response": {
      const cmds = readCommands(m.response?.response?.commands);
      return cmds.length ? { ...s, commands: cmds } : s;
    }

    case "stream_event": {
      const e = m.event ?? {};
      if (e.type === "message_start") return { ...s, busy: true, streaming: { messageId: e.message?.id ?? newId("m"), blocks: {} } };
      if (!s.streaming) return s;
      if (e.type === "content_block_start" && e.content_block?.type === "text") {
        const id = `${s.streaming.messageId}:${e.index}`;
        return {
          ...s,
          streaming: { ...s.streaming, blocks: { ...s.streaming.blocks, [e.index]: id } },
          items: [...s.items, { kind: "text", id, text: e.content_block.text ?? "", streaming: true }],
        };
      }
      if (e.type === "content_block_delta" && e.delta?.type === "text_delta") {
        const id = s.streaming.blocks[e.index];
        if (!id) return s;
        return { ...s, items: update(s.items, id, (it) => (it.kind === "text" ? { ...it, text: it.text + (e.delta.text ?? "") } : it)) };
      }
      return s;
    }

    case "assistant": {
      const msgId: string = m.message?.id ?? "";
      let items = s.items;
      for (const b of (m.message?.content ?? []) as Json[]) {
        if (b.type === "text") {
          const text = String(b.text ?? "");
          // the finished block replaces its streamed copy; without streaming, add it
          const streamed = items.find((it) => it.kind === "text" && it.streaming && it.id.startsWith(`${msgId}:`));
          if (streamed) items = update(items, streamed.id, () => ({ kind: "text", id: streamed.id, text, streaming: false }));
          else if (text.trim()) items = [...items, { kind: "text", id: newId("t"), text, streaming: false }];
        } else if (b.type === "tool_use" && b.name !== "AskUserQuestion" && !items.some((it) => it.id === b.id)) {
          // (a question shows as its own card, from the permission request that follows)
          items = [...items, { kind: "tool", id: b.id, name: String(b.name ?? "tool"), input: (b.input as Json) ?? {}, status: "running" }];
        }
      }
      return { ...s, busy: true, items };
    }

    case "user": {
      const content = m.message?.content;
      if (!Array.isArray(content)) return s;
      let items = s.items;
      for (const b of content as Json[]) {
        if (b.type !== "tool_result") continue;
        items = update(items, b.tool_use_id, (it) => (it.kind === "tool" ? { ...it, status: b.is_error ? "error" : "done", result: resultText(b.content) } : it));
      }
      return { ...s, items };
    }

    case "control_request": {
      const r = m.request ?? {};
      if (r.subtype !== "can_use_tool") return s;
      const input: Json = r.input ?? {};
      if (r.tool_name === "AskUserQuestion" && Array.isArray(input.questions)) {
        return { ...s, items: [...s.items, { kind: "question", id: m.request_id, input, questions: input.questions as ChatQuestion[] }] };
      }
      return {
        ...s,
        items: [
          ...s.items,
          {
            kind: "permission",
            id: m.request_id,
            tool: String(r.display_name ?? r.tool_name ?? "tool"),
            input,
            description: r.description || undefined,
            suggestions: Array.isArray(r.permission_suggestions) && r.permission_suggestions.length ? r.permission_suggestions : undefined,
          },
        ],
      };
    }

    case "control_cancel_request":
      return answerItem(s, m.request_id, "cancelled");

    case "result": {
      const done = endSession(s);
      const sessionId = m.session_id ?? s.sessionId;
      if (m.is_error && m.subtype !== "error_during_execution") {
        const why = typeof m.result === "string" && m.result ? m.result : Array.isArray(m.errors) ? m.errors.join("; ") : String(m.subtype ?? "error");
        return addNotice({ ...done, sessionId }, why, "error");
      }
      return { ...done, sessionId };
    }
  }
  return s;
}

// ---- what Keel writes to Claude ----

export const userLine = (text: string) => JSON.stringify({ type: "user", message: { role: "user", content: text }, parent_tool_use_id: null });

export const controlLine = (requestId: string, subtype: string) => JSON.stringify({ type: "control_request", request_id: requestId, request: { subtype } });

export const allowLine = (requestId: string, input: Record<string, unknown>, updatedPermissions?: unknown[]) =>
  JSON.stringify({
    type: "control_response",
    response: { subtype: "success", request_id: requestId, response: { behavior: "allow", updatedInput: input, ...(updatedPermissions ? { updatedPermissions } : {}) } },
  });

export const denyLine = (requestId: string, message: string) =>
  JSON.stringify({ type: "control_response", response: { subtype: "success", request_id: requestId, response: { behavior: "deny", message } } });

/** Claude asked something Keel doesn't handle (hooks, SDK MCP servers): say so rather than leave it waiting. */
export const unsupportedLine = (requestId: string) =>
  JSON.stringify({ type: "control_response", response: { subtype: "error", request_id: requestId, error: "Keel doesn't support this request" } });

// ---- how tool calls read in the chat ----

/** A one-line summary of a tool call: "Read logs/2026/2026-10-30.md", "Bash git status", … */
export function toolSummary(name: string, input: Record<string, unknown>, holdDir?: string): string {
  const str = (k: string) => (typeof input[k] === "string" ? (input[k] as string) : "");
  const path = (p: string) => relativeToHold(p, holdDir);
  switch (name) {
    case "Read":
    case "Write":
    case "Edit":
    case "NotebookEdit":
      return path(str("file_path") || str("notebook_path"));
    case "Bash":
    case "PowerShell":
      return str("description") || str("command");
    case "Glob":
    case "Grep":
      return str("pattern") + (str("path") ? ` in ${path(str("path"))}` : "");
    case "WebFetch":
      return str("url");
    case "WebSearch":
      return str("query");
    case "Skill":
      return str("skill");
    case "Task":
    case "Agent":
      return str("description");
    case "TodoWrite":
      return "Update the plan";
  }
  const first = Object.values(input).find((v) => typeof v === "string") as string | undefined;
  return first ?? "";
}

/** A path inside the Hold, relative and with forward slashes; anything else unchanged. */
export function relativeToHold(p: string, holdDir?: string): string {
  if (!holdDir || !p) return p;
  const norm = (x: string) => x.replace(/\\/g, "/").replace(/\/+$/, "");
  const file = norm(p);
  const dir = norm(holdDir);
  return file.toLowerCase().startsWith(dir.toLowerCase() + "/") ? file.slice(dir.length + 1) : p;
}

/** Friendlier names for Claude's tools; MCP tools (mcp__server__tool) show as "tool (server)". */
export function toolLabel(name: string): string {
  const mcp = /^mcp__(.+?)__(.+)$/.exec(name);
  if (mcp) return `${mcp[2].replace(/_/g, " ")} (${mcp[1].replace(/_/g, " ")})`;
  const names: Record<string, string> = { Bash: "Run", PowerShell: "Run", Glob: "Find files", Grep: "Search", WebFetch: "Fetch", WebSearch: "Web search", Task: "Agent", TodoWrite: "Plan" };
  return names[name] ?? name;
}
