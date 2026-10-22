import { describe, expect, it } from "vitest";
import { MemoryFs } from "./fs";
import { Hold, PINS_PATH } from "./hold";

async function makeHold(files: Record<string, string> = {}) {
  const hold = new Hold(new MemoryFs({ "notes/seed.md": "# Seed\n", ...files }));
  await hold.init();
  return hold;
}

describe("organizing the hold", () => {
  it("pins persist in the hold and follow moves", async () => {
    const hold = await makeHold({ "notes/A.md": "# A\n" });
    await hold.setPinned("notes/A.md", true);
    expect(JSON.parse(await hold.fs.read(PINS_PATH))).toEqual(["notes/A.md"]);
    // a fresh Hold over the same files reads them back
    const again = new Hold(hold.fs);
    await again.init();
    expect(again.pins).toEqual(["notes/A.md"]);
    // and they aren't indexed as notes
    expect(again.all().some((f) => f.path.startsWith(".keel"))).toBe(false);
    await hold.createFolder("notes", "Clients");
    const moved = await hold.moveFile("notes/A.md", "notes/Clients");
    expect(moved).toBe("notes/Clients/A.md");
    expect(hold.pins).toEqual(["notes/Clients/A.md"]);
    await hold.setPinned(moved, false);
    expect(hold.pins).toEqual([]);
  });

  it("creates, lists, renames and deletes folders", async () => {
    const hold = await makeHold({ "notes/x.md": "# X\n" });
    await hold.createFolder("notes", "Hogan: FLIS?");
    expect(await hold.noteFolders()).toEqual(["notes/Hogan FLIS"]);
    await expect(hold.createFolder("notes", "Hogan FLIS")).rejects.toThrow(/already exists/);
    await hold.moveFile("notes/x.md", "notes/Hogan FLIS");
    const renamed: [string, string][] = [];
    hold.onRename((a, b) => renamed.push([a, b]));
    const to = await hold.renameFolder("notes/Hogan FLIS", "FLIS");
    expect(to).toBe("notes/FLIS");
    expect(hold.get("notes/FLIS/x.md")).toBeDefined();
    expect(renamed).toEqual([["notes/Hogan FLIS/x.md", "notes/FLIS/x.md"]]);
    await expect(hold.deleteFolder("notes/FLIS")).rejects.toThrow(/isn't empty/);
    await hold.moveFile("notes/FLIS/x.md", "notes");
    await hold.deleteFolder("notes/FLIS");
    expect(await hold.noteFolders()).toEqual([]);
  });

  it("renames a note, its title and every link to it", async () => {
    const hold = await makeHold({
      "notes/Retention design.md": "---\ncreated: 2026-10-20\n---\n# Retention design\n\nBody.\n",
      "notes/Other.md": "See [[Retention design]], [[retention design|the design]] and [[Retention design#Schema]]. Not [[Retention]].\n",
      "logs/2026/2026-10-21.md": "---\ndate: 2026-10-21\n---\n- link: [[Retention design]]\n",
    });
    await hold.setPinned("notes/Retention design.md", true);
    const moves: string[] = [];
    hold.onRename((a, b) => moves.push(`${a} -> ${b}`));
    const to = await hold.renameFile("notes/Retention design.md", "Retention policy");
    expect(to).toBe("notes/Retention policy.md");
    expect(hold.get(to)!.title).toBe("Retention policy");
    expect(hold.get("notes/Retention design.md")).toBeUndefined();
    expect(hold.get("notes/Other.md")!.content).toBe(
      "See [[Retention policy]], [[Retention policy|the design]] and [[Retention policy#Schema]]. Not [[Retention]].\n",
    );
    expect(hold.get("logs/2026/2026-10-21.md")!.content).toContain("[[Retention policy]]");
    expect(hold.backlinks(to).map((f) => f.path).sort()).toEqual(["logs/2026/2026-10-21.md", "notes/Other.md"]);
    expect(hold.pins).toEqual([to]);
    expect(moves).toEqual(["notes/Retention design.md -> notes/Retention policy.md"]);
  });

  it("keeps a meeting's date prefix and frontmatter title in step", async () => {
    const hold = await makeHold({
      "meetings/2026-10-21 Sync.md": "---\ntitle: Sync\ndate: 2026-10-21\n---\n# Sync\n",
    });
    const to = await hold.renameFile("meetings/2026-10-21 Sync.md", "FLIS design review");
    expect(to).toBe("meetings/2026-10-21 FLIS design review.md");
    expect(hold.get(to)!.frontmatter.title).toBe("FLIS design review");
    expect(hold.get(to)!.content).toContain("# FLIS design review");
  });

  it("refuses to rename clients and projects", async () => {
    const hold = await makeHold({ "clients/acme.md": "# Acme\n", "projects/Portal.md": "---\nclient: acme\n---\n" });
    await expect(hold.renameFile("clients/acme.md", "Acme Corp")).rejects.toThrow(/can't be renamed/);
    await expect(hold.renameFile("projects/Portal.md", "Portal 2")).rejects.toThrow(/can't be renamed/);
  });

  it("archives notes and marks projects done", async () => {
    const hold = await makeHold({ "notes/Old.md": "# Old\n", "projects/P.md": "---\nclient: acme\nstatus: active\n---\n" });
    await hold.setArchived("notes/Old.md", true);
    expect(hold.isArchived(hold.get("notes/Old.md")!)).toBe(true);
    await hold.setArchived("notes/Old.md", false);
    expect(hold.get("notes/Old.md")!.frontmatter.archived).toBeUndefined();
    await hold.setArchived("projects/P.md", true);
    expect(hold.get("projects/P.md")!.frontmatter.status).toBe("done");
    expect(hold.isArchived(hold.get("projects/P.md")!)).toBe(true);
  });
});
