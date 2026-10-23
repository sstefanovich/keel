/** Side-by-side placement of overlapping events in a day column. */

export interface Span {
  start: number;
  end: number;
}

export interface Placed<T> {
  item: T;
  /** 0-based column within its overlap group */
  col: number;
  /** Columns in its overlap group */
  cols: number;
}

/**
 * Greedy columns: events that overlap share the width; each group of mutually overlapping events
 * gets as many columns as it needs at its busiest. Zero-length events count as 15 minutes.
 */
export function layoutDay<T extends Span>(items: T[], minLength = 15 * 60_000): Placed<T>[] {
  const sorted = [...items].sort((a, b) => a.start - b.start || b.end - a.end);
  const out: Placed<T>[] = [];
  let group: Placed<T>[] = [];
  let colEnds: number[] = [];
  let groupEnd = -Infinity;
  const end = (x: T) => Math.max(x.end, x.start + minLength);
  const close = () => {
    for (const p of group) p.cols = colEnds.length;
    out.push(...group);
    group = [];
    colEnds = [];
  };
  for (const it of sorted) {
    if (it.start >= groupEnd && group.length) close();
    let col = colEnds.findIndex((e) => e <= it.start);
    if (col < 0) {
      col = colEnds.length;
      colEnds.push(end(it));
    } else colEnds[col] = end(it);
    group.push({ item: it, col, cols: 0 });
    groupEnd = Math.max(groupEnd === -Infinity ? 0 : groupEnd, end(it));
  }
  if (group.length) close();
  return out;
}
