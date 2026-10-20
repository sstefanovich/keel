import { useState } from "react";
import { ISODate, addDays, startOfWeek, today } from "../../core/dates";
import { buildReport, reportHtml, reportMarkdown } from "../../core/report";
import { safeFileName } from "../../core/templates";
import { copyRich, copyText } from "../../lib/platform";
import { useHold } from "../HoldContext";
import { useNav } from "../nav";

type Period = "this-week" | "last-week" | "last-2-weeks" | "custom";

function range(p: Period, custom: [ISODate, ISODate]): [ISODate, ISODate] {
  const mon = startOfWeek(today());
  switch (p) {
    case "this-week":
      return [mon, addDays(mon, 6)];
    case "last-week":
      return [addDays(mon, -7), addDays(mon, -1)];
    case "last-2-weeks":
      return [addDays(mon, -14), addDays(mon, -1)];
    case "custom":
      return custom;
  }
}

/** Dispatch: a client status update built from logs, meetings, tasks and hours. */
export function DispatchView() {
  const { hold, bump, reportError, toast, focus } = useHold();
  const nav = useNav();
  const clients = [...hold.clients().values()].sort((a, b) => a.name.localeCompare(b.name));
  const [client, setClient] = useState(focus ?? clients[0]?.key ?? "");
  const [period, setPeriod] = useState<Period>("this-week");
  const [custom, setCustom] = useState<[ISODate, ISODate]>([addDays(today(), -13), today()]);
  const [includeHours, setIncludeHours] = useState(true);

  if (!clients.length) {
    return (
      <div className="page">
        <header className="page-head">
          <h1>Dispatch</h1>
        </header>
        <p className="empty panel">Create a client first. Dispatch builds their weekly status update from your logs, meetings and tasks.</p>
      </div>
    );
  }

  const key = hold.clients().has(client) ? client : clients[0].key;
  const [from, to] = range(period, custom);
  const report = buildReport(hold, key, from, to);
  const opts = { includeHours };
  const md = reportMarkdown(report, opts);
  const html = reportHtml(report, opts);

  const save = async () => {
    try {
      const name = safeFileName(`${to} ${report.client.name} status`);
      const path = `notes/Status/${name}.md`;
      const body = md.replace(/^# .*\n/, "");
      await hold.save(path, `---\nclient: ${key}\ndate: ${to}\n---\n# ${report.client.name} status: ${to}\n${body}`);
      bump();
      nav.openFile(path);
    } catch (e) {
      reportError(e);
    }
  };

  return (
    <div className="page">
      <header className="page-head row">
        <div>
          <h1>Dispatch</h1>
          <p className="muted">A status update for a client, built from your logs, meetings, tasks and hours.</p>
        </div>
      </header>

      <div className="toolbar panel dispatch-controls">
        <select value={key} onChange={(e) => setClient(e.target.value)} aria-label="Client">
          {clients.map((c) => (
            <option key={c.key} value={c.key}>
              {c.name}
            </option>
          ))}
        </select>
        <select value={period} onChange={(e) => setPeriod(e.target.value as Period)} aria-label="Period">
          <option value="this-week">This week</option>
          <option value="last-week">Last week</option>
          <option value="last-2-weeks">Last two weeks</option>
          <option value="custom">Custom…</option>
        </select>
        {period === "custom" && (
          <>
            <input type="date" value={custom[0]} onChange={(e) => setCustom([e.target.value, custom[1]])} aria-label="From" />
            <input type="date" value={custom[1]} onChange={(e) => setCustom([custom[0], e.target.value])} aria-label="To" />
          </>
        )}
        <label className="check-inline">
          <input type="checkbox" checked={includeHours} onChange={(e) => setIncludeHours(e.target.checked)} /> Include hours
        </label>
        <span className="spacer" />
        <button
          className="primary"
          onClick={async () => {
            await copyRich(html, md);
            toast("Copied: paste into an email or Teams");
          }}
        >
          Copy for email
        </button>
        <button
          onClick={async () => {
            await copyText(md);
            toast("Markdown copied");
          }}
        >
          Copy markdown
        </button>
        <button onClick={save}>Save as note</button>
      </div>

      <article className="panel dispatch-preview" dangerouslySetInnerHTML={{ __html: html }} />
      <p className="muted small">
        Tasks count toward a client when they're in its client, project or meeting files (<code>client:</code> in frontmatter), or tagged{" "}
        <code>#{key}</code>. Completed items use the date you ticked them.
      </p>
    </div>
  );
}
