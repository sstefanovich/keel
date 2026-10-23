import { describe, expect, it } from "vitest";
import { linesOf, noteFromText, takeText } from "./scratch";

describe("scratchpad", () => {
  const page = "call Sam re cutover\nidea: cache the token\n\nbuy ink\n";

  it("takes a selection and closes the gap", () => {
    const from = page.indexOf("idea");
    const to = page.indexOf("\n\nbuy");
    expect(takeText(page, from, to)).toEqual({ taken: "idea: cache the token", rest: "call Sam re cutover\n\nbuy ink\n", at: from });
  });

  it("with nothing selected, takes the cursor's whole line", () => {
    const at = page.indexOf("Sam");
    expect(takeText(page, at, at)).toEqual({ taken: "call Sam re cutover", rest: "idea: cache the token\n\nbuy ink\n", at: 0 });
    const last = page.indexOf("ink");
    expect(takeText(page, last, last).rest).toBe("call Sam re cutover\nidea: cache the token\n\n");
    expect(takeText("only line", 3, 3)).toEqual({ taken: "only line", rest: "", at: 0 });
  });

  it("takes several lines at once", () => {
    const { taken, rest } = takeText(page, 0, page.indexOf("\n\n"));
    expect(taken).toBe("call Sam re cutover\nidea: cache the token");
    expect(rest).toBe("\nbuy ink\n");
  });

  it("splits lines for tasks, dropping typed bullets and boxes", () => {
    expect(linesOf("- call Sam\n\n* [ ] buy ink\n  • review PR  \n[x] done thing")).toEqual(["call Sam", "buy ink", "review PR", "done thing"]);
  });

  it("makes a note title from the first line", () => {
    expect(noteFromText("# Token caching\nuse redis\nTTL 5 min")).toEqual({ title: "Token caching", body: "use redis\nTTL 5 min" });
    expect(noteFromText("just one line")).toEqual({ title: "just one line", body: "" });
  });
});
