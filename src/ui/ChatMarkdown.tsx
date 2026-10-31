import { ReactNode } from "react";

/**
 * Just enough markdown for Claude's chat replies: headings, lists, quotes, tables, code and
 * inline styles. Builds React elements (never HTML strings), so nothing Claude writes can run.
 * `onLink` gets each link's target, and inline `code` that looks like a file path.
 */
export function ChatMarkdown({ text, onLink, isPath }: { text: string; onLink: (target: string) => void; isPath?: (s: string) => boolean }) {
  return <>{blocks(text, { onLink, isPath })}</>;
}

interface Ctx {
  onLink: (target: string) => void;
  isPath?: (s: string) => boolean;
}

const LIST = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const TABLE_RULE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

function blocks(src: string, ctx: Ctx): ReactNode[] {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const out: ReactNode[] = [];
  let i = 0;
  const key = () => `b${out.length}`;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const fence = /^\s*(```+|~~~+)\s*([\w+-]*)/.exec(line);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence[1])) body.push(lines[i++]);
      i++; // closing fence
      out.push(
        <pre key={key()} className="chat-code" data-lang={fence[2] || undefined}>
          <code>{body.join("\n")}</code>
        </pre>,
      );
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      const level = Math.min(h[1].length + 2, 6); // keep headings small in a sidebar
      const Tag = `h${level}` as "h3";
      out.push(<Tag key={key()}>{inline(h[2], ctx)}</Tag>);
      i++;
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      out.push(<hr key={key()} />);
      i++;
      continue;
    }
    if (/^\s*>/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) body.push(lines[i++].replace(/^\s*>\s?/, ""));
      out.push(<blockquote key={key()}>{blocks(body.join("\n"), ctx)}</blockquote>);
      continue;
    }
    if (line.includes("|") && i + 1 < lines.length && TABLE_RULE.test(lines[i + 1])) {
      const cells = (l: string) => l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
      const head = cells(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) rows.push(cells(lines[i++]));
      out.push(
        <div key={key()} className="chat-table-wrap">
          <table>
            <thead>
              <tr>{head.map((c, j) => <th key={j}>{inline(c, ctx)}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((r, k) => (
                <tr key={k}>{head.map((_, j) => <td key={j}>{inline(r[j] ?? "", ctx)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    if (LIST.test(line)) {
      const ordered = /\d/.test(LIST.exec(line)![2]);
      const items: string[] = [];
      const base = LIST.exec(line)![1].length;
      while (i < lines.length) {
        const m = LIST.exec(lines[i]);
        if (m && m[1].length <= base + 1) items.push(m[3]);
        else if (lines[i].trim() && /^\s/.test(lines[i]) && items.length) items[items.length - 1] += "\n" + lines[i].trim();
        else break;
        i++;
      }
      const Tag = ordered ? "ol" : "ul";
      out.push(
        <Tag key={key()}>
          {items.map((it, j) => {
            const task = /^\[([ xX])\]\s+(.*)$/s.exec(it);
            return (
              <li key={j} className={task ? "task" : undefined}>
                {task && <input type="checkbox" checked={task[1] !== " "} readOnly tabIndex={-1} />}
                {multiline(task ? task[2] : it, ctx)}
              </li>
            );
          })}
        </Tag>,
      );
      continue;
    }
    // paragraph: until a blank line or another block starts
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^\s*(```|~~~|#{1,6}\s|>)/.test(lines[i]) && !(para.length && LIST.test(lines[i]))) para.push(lines[i++]);
    out.push(<p key={key()}>{multiline(para.join("\n"), ctx)}</p>);
  }
  return out;
}

/** Inline text where single newlines are line breaks (as Claude means them). */
function multiline(text: string, ctx: Ctx): ReactNode[] {
  return text.split("\n").flatMap((l, j) => (j ? [<br key={`br${j}`} />, ...inline(l, ctx, `l${j}`)] : inline(l, ctx, `l${j}`)));
}

const INLINE = /(`+)([^`]+?)\1|\*\*([^*]+)\*\*|__([^_]+)__|(?<![\w*])\*([^*\s][^*]*?)\*(?!\w)|(?<!\w)_([^_\s][^_]*?)_(?!\w)|\[([^\]]+)\]\(([^)\s]+)\)|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/g;

function inline(text: string, ctx: Ctx, prefix = "i"): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let n = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index! > last) out.push(text.slice(last, m.index));
    const k = `${prefix}-${n++}`;
    if (m[2] !== undefined) {
      const code = m[2].trim();
      out.push(
        ctx.isPath?.(code) ? (
          <button key={k} className="chat-path" onClick={() => ctx.onLink(code)} title="Open in Keel">
            <code>{code}</code>
          </button>
        ) : (
          <code key={k}>{m[2]}</code>
        ),
      );
    } else if (m[3] !== undefined || m[4] !== undefined) out.push(<strong key={k}>{inline(m[3] ?? m[4], ctx, k)}</strong>);
    else if (m[5] !== undefined || m[6] !== undefined) out.push(<em key={k}>{inline(m[5] ?? m[6], ctx, k)}</em>);
    else {
      const label = m[7] ?? m[9];
      const target = m[8] ?? m[9];
      out.push(
        <a
          key={k}
          href={target}
          onClick={(e) => {
            e.preventDefault();
            ctx.onLink(target);
          }}
        >
          {m[7] !== undefined ? inline(label, ctx, k) : label}
        </a>,
      );
    }
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
