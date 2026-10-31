import { describe, expect, it } from "vitest";
import { ChatState, addUserMessage, allowLine, answerItem, applyMessage, emptyChat, endSession, relativeToHold, toolLabel, toolSummary } from "./claudeChat";

// shapes as Claude Code 2.1 prints them with --output-format stream-json --include-partial-messages
const run = (msgs: object[], from: ChatState = emptyChat()) => msgs.reduce<ChatState>((s, m) => applyMessage(s, m), from);
const ev = (event: object) => ({ type: "stream_event", event, parent_tool_use_id: null });

describe("claude chat", () => {
  it("streams a reply, then settles on the finished text", () => {
    let s = addUserMessage(emptyChat(), "hello");
    s = run(
      [
        ev({ type: "message_start", message: { id: "msg_1" } }),
        ev({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }),
        ev({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hi " } }),
        ev({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "there" } }),
      ],
      s,
    );
    expect(s.items[1]).toMatchObject({ kind: "text", text: "Hi there", streaming: true });
    s = run([{ type: "assistant", message: { id: "msg_1", content: [{ type: "text", text: "Hi there!" }] }, parent_tool_use_id: null }], s);
    expect(s.items).toHaveLength(2);
    expect(s.items[1]).toMatchObject({ kind: "text", text: "Hi there!", streaming: false });
    s = run([{ type: "result", subtype: "success", is_error: false, session_id: "sess-1" }], s);
    expect(s.busy).toBe(false);
    expect(s.sessionId).toBe("sess-1");
  });

  it("tracks a tool call through its permission prompt to its result", () => {
    const input = { file_path: "C:\\Users\\me\\Keel\\notes\\a.md", content: "hi" };
    let s = run([
      { type: "assistant", message: { id: "m", content: [{ type: "tool_use", id: "tu1", name: "Write", input }] }, parent_tool_use_id: null },
      {
        type: "control_request",
        request_id: "r1",
        request: { subtype: "can_use_tool", tool_name: "Write", display_name: "Write", input, permission_suggestions: [{ type: "setMode", mode: "acceptEdits", destination: "session" }] },
      },
    ]);
    expect(s.items.map((i) => i.kind)).toEqual(["tool", "permission"]);
    expect(s.items[1]).toMatchObject({ tool: "Write", suggestions: [{ mode: "acceptEdits" }] });
    s = answerItem(s, "r1", "always");
    s = run([{ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "tu1", content: [{ type: "text", text: "File created" }] }] }, parent_tool_use_id: null }], s);
    expect(s.items[0]).toMatchObject({ status: "done", result: "File created" });
    expect(s.items[1]).toMatchObject({ answer: "always" });
    expect(JSON.parse(allowLine("r1", input, [{ type: "setMode" }]))).toEqual({
      type: "control_response",
      response: { subtype: "success", request_id: "r1", response: { behavior: "allow", updatedInput: input, updatedPermissions: [{ type: "setMode" }] } },
    });
  });

  it("turns AskUserQuestion into a question card", () => {
    const input = { questions: [{ question: "Which colour?", header: "Colour", multiSelect: false, options: [{ label: "Red" }, { label: "Blue" }] }] };
    const s = run([{ type: "control_request", request_id: "q1", request: { subtype: "can_use_tool", tool_name: "AskUserQuestion", input } }]);
    expect(s.items[0]).toMatchObject({ kind: "question", id: "q1", questions: input.questions });
  });

  it("ignores a subagent's own messages and keeps command descriptions from initialize", () => {
    let s = run([
      { type: "control_response", response: { subtype: "success", request_id: "init", response: { commands: [{ name: "timecard", description: "Enter a week's hours", argumentHint: "[week]" }] } } },
      { type: "system", subtype: "init", session_id: "s", model: "claude-opus-5-5", slash_commands: ["timecard", "compact"] },
      { type: "assistant", message: { id: "x", content: [{ type: "text", text: "inside the agent" }] }, parent_tool_use_id: "tu9" },
    ]);
    expect(s.items).toEqual([]);
    expect(s.model).toBe("claude-opus-5-5");
    expect(s.commands).toEqual([{ name: "timecard", description: "Enter a week's hours", argumentHint: "[week]" }]);
    s = run([{ type: "control_request", request_id: "p", request: { subtype: "can_use_tool", tool_name: "Bash", input: { command: "ls" } } }], addUserMessage(s, "go"));
    s = endSession(s);
    expect(s.busy).toBe(false);
    expect(s.items[1]).toMatchObject({ kind: "permission", answer: "cancelled" });
  });

  it("reports a failed turn", () => {
    const s = run([{ type: "result", subtype: "error_max_turns", is_error: true, result: "Reached the turn limit" }], addUserMessage(emptyChat(), "x"));
    expect(s.items[1]).toMatchObject({ kind: "notice", tone: "error", text: "Reached the turn limit" });
  });

  it("describes tool calls briefly", () => {
    const dir = "C:\\Users\\me\\Keel";
    expect(relativeToHold("C:\\Users\\me\\Keel\\logs\\2026\\2026-10-30.md", dir)).toBe("logs/2026/2026-10-30.md");
    expect(relativeToHold("C:\\elsewhere\\x.md", dir)).toBe("C:\\elsewhere\\x.md");
    expect(toolSummary("Read", { file_path: "c:/users/me/keel/notes/a.md" }, dir)).toBe("notes/a.md");
    expect(toolSummary("Bash", { command: "git status", description: "Show status" })).toBe("Show status");
    expect(toolLabel("mcp__browser__browser_navigate")).toBe("browser navigate (browser)");
    expect(toolLabel("Grep")).toBe("Search");
  });
});
