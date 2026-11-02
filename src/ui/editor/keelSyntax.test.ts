import { CompletionContext } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { describe, expect, it, vi } from "vitest";
import type { WorkTarget } from "../workTargets";
import { keelCompletions } from "./keelSyntax";

// both touch window/DOM at import; the completion source doesn't need them
vi.mock("../theme", () => ({ currentTheme: () => "light" }));
vi.mock("../mermaid", () => ({ mountMermaid: () => {} }));

const targets: WorkTarget[] = [
  { key: "flis-retain-pa", project: "flis-retain-pa", client: "hogan-lovells", detail: "FLIS Retain / PA · Hogan Lovells" },
  { key: "portal", project: "portal", client: "acme", detail: "Portal · Acme" },
  { key: "acme", client: "acme", detail: "Acme (client)" },
  { key: "hogan-lovells", client: "hogan-lovells", detail: "Hogan Lovells (client)" },
];

function labels(doc: string, pos?: number) {
  const state = EditorState.create({ doc });
  const p = pos ?? doc.length;
  const ctx = new CompletionContext(state, p, true);
  return keelCompletions(() => ["Note"], () => targets)(ctx)?.options.map((o) => o.label) ?? null;
}

describe("keelCompletions @ projects", () => {
  it("lists projects on a work head", () => {
    expect(labels("- 6h @")).toEqual(["flis-retain-pa", "portal", "acme", "hogan-lovells"]);
  });
  it("lists projects on a bare @ (Today's Work section is often a blank line)", () => {
    expect(labels("@")).toEqual(["flis-retain-pa", "portal", "acme", "hogan-lovells"]);
    expect(labels("## Work\n@")).toEqual(["flis-retain-pa", "portal", "acme", "hogan-lovells"]);
  });
  it("lists projects on a long done-item bullet, not due/remind", () => {
    const got = labels("  - reviewed the auth PR @");
    expect(got).toEqual(["flis-retain-pa", "portal", "acme", "hogan-lovells"]);
    expect(got?.some((l) => l.startsWith("due("))).toBe(false);
  });
  it("lists projects on a task, plus due/remind/waiting", () => {
    const got = labels("- [ ] Call dentist @")!;
    expect(got.slice(0, 4)).toEqual(["flis-retain-pa", "portal", "acme", "hogan-lovells"]);
    expect(got.some((l) => l.startsWith("due("))).toBe(true);
    expect(got).toContain("waiting()");
  });
  it("narrows @client/ to that client's projects", () => {
    expect(labels("- 6h @acme/")).toEqual(["portal"]);
  });
  it("does not treat an email as a mention", () => {
    expect(labels("email me@")).toBeNull();
  });
});
