/** A line diff for showing what changed between two versions of a file. */

export type DiffLine = { kind: "same" | "add" | "del"; text: string };

const MAX_CELLS = 4_000_000;

/** Lines of `a` → lines of `b` (LCS). Very large inputs fall back to "all removed, all added". */
export function diffLines(a: string, b: string): DiffLine[] {
  const x = a.replace(/\r\n/g, "\n").split("\n");
  const y = b.replace(/\r\n/g, "\n").split("\n");
  // trim the common head and tail so the table stays small
  let head = 0;
  while (head < x.length && head < y.length && x[head] === y[head]) head++;
  let tail = 0;
  while (tail < x.length - head && tail < y.length - head && x[x.length - 1 - tail] === y[y.length - 1 - tail]) tail++;
  const xs = x.slice(head, x.length - tail);
  const ys = y.slice(head, y.length - tail);
  const out: DiffLine[] = x.slice(0, head).map((text) => ({ kind: "same", text }));

  if (xs.length * ys.length > MAX_CELLS) {
    out.push(...xs.map((text) => ({ kind: "del" as const, text })), ...ys.map((text) => ({ kind: "add" as const, text })));
  } else {
    const n = xs.length;
    const m = ys.length;
    const lcs = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) lcs[i][j] = xs[i] === ys[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (xs[i] === ys[j]) {
        out.push({ kind: "same", text: xs[i] });
        i++;
        j++;
      } else if (lcs[i + 1][j] >= lcs[i][j + 1]) out.push({ kind: "del", text: xs[i++] });
      else out.push({ kind: "add", text: ys[j++] });
    }
    while (i < n) out.push({ kind: "del", text: xs[i++] });
    while (j < m) out.push({ kind: "add", text: ys[j++] });
  }
  out.push(...x.slice(x.length - tail).map((text) => ({ kind: "same" as const, text })));
  return out;
}

/** "+3 −1" style counts. */
export function diffStats(d: DiffLine[]): { added: number; removed: number } {
  return { added: d.filter((l) => l.kind === "add").length, removed: d.filter((l) => l.kind === "del").length };
}
