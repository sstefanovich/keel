import { ReactNode, useState } from "react";
import { ISODate, addDays, addMonths, endOfMonth, formatShort, startOfMonth, startOfWeek, today, weekdayOf } from "../../core/dates";
import { round2 } from "../../core/hold";
import { copyText, exportText } from "../../lib/platform";
import { TaskListStyle, WeekRow, buildWeek, dayItems, rowReport, rowTsv, weekTsv } from "../../core/week";
import { useHold } from "../HoldContext";
import { useNav } from "../nav";
import { useWeekStart } from "../weekStart";
import { Clock } from "lucide-react";
import { EmptyState } from "../EmptyState";

type Preset = "this-week" | "last-week" | "this-month" | "last-month" | "this-year" | "custom";

function rangeFor(p: Preset, d: ISODate, weekStart: number): [ISODate, ISODate] {
  const s = startOfWeek(d, weekStart);
  switch (p) {
    case "this-week":
      return [s, addDays(s, 6)];
    case "last-week":
      return [addDays(s, -7), addDays(s, -1)];
    case "this-month":
      return [startOfMonth(d), endOfMonth(d)];
    case "last-month": {
      const m = addMonths(d, -1);
      return [m, endOfMonth(m)];
    }
    case "this-year":
    case "custom":
      return [`${d.slice(0, 4)}-01-01`, `${d.slice(0, 4)}-12-31`];
  }
}

const fmtHours = (h: number) => `${round2(h)}h`;

function TotalsView({ toggle }: { toggle: ReactNode }) {
  const { hold, bump, reportError, toast, focus } = useHold();
  const nav = useNav();
  const weekStart = useWeekStart();
  const [preset, setPreset] = useState<Preset>("this-week");
  const [custom, setCustom] = useState<[ISODate, ISODate]>(() => rangeFor("this-month", today(), weekStart));
  const [from, to] = preset === "custom" ? custom : rangeFor(preset, today(), weekStart);
  const ts = hold.timesheet(from, to, focus);

  const projectCount = ts.byClient.reduce((n, c) => n + c.byProject.filter((p) => p.key).length, 0);

  const doExport = async () => {
    try {
      if (await exportText(`keel-hours-${from}-to-${to}.csv`, hold.timesheetCsv(ts))) toast("Timesheet exported");
    } catch (e) {
      reportError(e);
    }
  };

  const createClient = async (key: string) => {
    try {
      const path = await hold.createClient(key);
      bump();
      nav.openFile(path);
    } catch (e) {
      reportError(e);
    }
  };

  const days = [...new Set(ts.entries.map((e) => e.date))];

  return (
    <div className="page">
      <header className="page-head row">
        <div>
          <h1>Timesheet</h1>
          <p className="muted">
            {formatShort(from)} – {formatShort(to)}
          </p>
        </div>
        <div className="toolbar">
          {toggle}
          <select value={preset} onChange={(e) => setPreset(e.target.value as Preset)} aria-label="Period">
            <option value="this-week">This week</option>
            <option value="last-week">Last week</option>
            <option value="this-month">This month</option>
            <option value="last-month">Last month</option>
            <option value="this-year">This year</option>
            <option value="custom">Custom…</option>
          </select>
          {preset === "custom" && (
            <>
              <input type="date" value={custom[0]} onChange={(e) => setCustom([e.target.value, custom[1]])} aria-label="From" />
              <input type="date" value={custom[1]} onChange={(e) => setCustom([custom[0], e.target.value])} aria-label="To" />
            </>
          )}
          <button onClick={doExport} disabled={!ts.entries.length}>
            Export CSV
          </button>
        </div>
      </header>

      <div className="stats">
        <div className="stat">
          <span className="stat-label">Hours</span>
          <span className="stat-value">{fmtHours(ts.totalHours)}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Projects</span>
          <span className="stat-value">{projectCount}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Days worked</span>
          <span className="stat-value">{days.length}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Clients</span>
          <span className="stat-value">{ts.byClient.length}</span>
        </div>
      </div>

      {ts.entries.length === 0 ? (
        <EmptyState icon={Clock} title="No hours in this period" actions={<button onClick={() => nav.openToday()}>Open today's log</button>}>
          <p>
            Add projects under <b>Work</b> in a day's log, or quick capture <code>6h @project</code> with Ctrl+K.
          </p>
        </EmptyState>
      ) : (
        <>
          <section className="panel">
            <h2>By client & project</h2>
            <table className="table">
              <thead>
                <tr>
                  <th>Client / project</th>
                  <th className="num">Hours</th>
                </tr>
              </thead>
              {ts.byClient.map(({ client, hours, byProject }) => (
                <tbody key={client.key}>
                  <tr>
                    <td>
                      {client.path ? (
                        <button className="link" onClick={() => nav.openFile(client.path!)}>
                          <b>{client.name}</b>
                        </button>
                      ) : (
                        <>
                          <b>@{client.key}</b>{" "}
                          <button className="link small" onClick={() => createClient(client.key)} title="Not a known client yet">
                            create client
                          </button>
                        </>
                      )}
                    </td>
                    <td className="num">
                      <b>{fmtHours(hours)}</b>
                    </td>
                  </tr>
                  {byProject.length > 1 || byProject[0]?.key
                    ? byProject.map((p) => (
                        <tr key={p.key || "_general"} className="sub-row">
                          <td>{p.name || "General"}</td>
                          <td className="num">{fmtHours(p.hours)}</td>
                        </tr>
                      ))
                    : null}
                </tbody>
              ))}
            </table>
          </section>

          <section className="panel">
            <h2>Entries</h2>
            <table className="table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Client</th>
                  <th className="num">Hours</th>
                  <th>Description</th>
                </tr>
              </thead>
              {days.map((day) => {
                const rows = ts.entries.filter((e) => e.date === day);
                return (
                  <tbody key={day}>
                    {rows.map((e, i) => (
                      <tr key={e.file + e.line} className="clickable" onClick={() => nav.openFile(e.file, e.line)}>
                        <td>{i === 0 ? formatShort(day) : ""}</td>
                        <td>@{e.client}</td>
                        <td className="num">{fmtHours(e.hours)}</td>
                        <td>{e.description}</td>
                      </tr>
                    ))}
                    {rows.length > 1 && (
                      <tr className="subtotal">
                        <td />
                        <td />
                        <td className="num">{fmtHours(ts.byDay.get(day) ?? 0)}</td>
                        <td />
                      </tr>
                    )}
                  </tbody>
                );
              })}
            </table>
          </section>
        </>
      )}
    </div>
  );
}

type Mode = "week" | "totals";

export function TimesheetView() {
  const [mode, setMode] = useState<Mode>(() => {
    try {
      return localStorage.getItem("keel.timesheetMode") === "totals" ? "totals" : "week";
    } catch {
      return "week";
    }
  });
  const choose = (m: Mode) => {
    setMode(m);
    try {
      localStorage.setItem("keel.timesheetMode", m);
    } catch {
      // ignore
    }
  };
  const toggle = (
    <div className="seg" role="tablist">
      <button role="tab" aria-selected={mode === "week"} className={mode === "week" ? "on" : ""} onClick={() => choose("week")}>
        Week
      </button>
      <button role="tab" aria-selected={mode === "totals"} className={mode === "totals" ? "on" : ""} onClick={() => choose("totals")}>
        Totals
      </button>
    </div>
  );
  return mode === "week" ? <WeekSheet toggle={toggle} /> : <TotalsView toggle={toggle} />;
}

const cell = (h: number) => (h ? String(round2(h)) : "");

/** Projects × days grid for entering into a timesheet system, plus per-project daily reports. */
function WeekSheet({ toggle }: { toggle: ReactNode }) {
  const { hold, toast, focus } = useHold();
  const nav = useNav();
  const weekStart = useWeekStart();
  // weeks relative to the current one, so changing the start day in Settings re-aligns at once
  const [offset, setOffset] = useState(0);
  const t = today();
  const week = buildWeek(hold, addDays(startOfWeek(t, weekStart), offset * 7), focus);
  const isWeekend = (d: string) => [0, 6].includes(weekdayOf(d));

  const [style, setStyleState] = useState<TaskListStyle>(() => {
    try {
      return localStorage.getItem("keel.taskListStyle") === "plain" ? "plain" : "bullets";
    } catch {
      return "bullets";
    }
  });
  const setStyle = (s: TaskListStyle) => {
    setStyleState(s);
    try {
      localStorage.setItem("keel.taskListStyle", s);
    } catch {
      // ignore
    }
  };

  const copy = async (text: string, what: string) => {
    await copyText(text);
    toast(`Copied ${what}`);
  };
  const copyTasks = (r: WeekRow, i: number) =>
    copy(dayItems(r, i, style), `${r.items[i].length} task${r.items[i].length === 1 ? "" : "s"}: ${r.label}, ${formatShort(week.days[i])}`);

  return (
    <div className="page week-page">
      <header className="page-head row">
        <div>
          <h1>Timesheet</h1>
          <p className="muted">
            Week of {formatShort(week.days[0])} – {formatShort(week.days[6])}
          </p>
        </div>
        <div className="toolbar">
          {toggle}
          <button onClick={() => setOffset(offset - 1)} aria-label="Previous week">
            ‹
          </button>
          <button onClick={() => setOffset(0)} disabled={offset === 0}>
            This week
          </button>
          <button onClick={() => setOffset(offset + 1)} aria-label="Next week">
            ›
          </button>
          <button onClick={() => copy(weekTsv(week), "the week grid")} disabled={!week.rows.length} title="Tab-separated, pastes into Excel or a form grid">
            Copy grid
          </button>
          <label className="check-inline" title="How copied task lists are formatted">
            Tasks as
            <select value={style} onChange={(e) => setStyle(e.target.value as TaskListStyle)} aria-label="Copy tasks as">
              <option value="bullets">- bullets</option>
              <option value="plain">plain lines</option>
            </select>
          </label>
        </div>
      </header>
      {week.rows.length > 0 && (
        <p className="muted small week-hint">
          Click hours to copy them; click <span className="cell-tasks demo">☰</span> to copy that project's tasks for that day.
        </p>
      )}

      {!week.rows.length ? (
        <EmptyState
          icon={Clock}
          title={offset === 0 ? "No work logged this week yet" : "No work logged that week"}
          actions={
            <>
              <button className="primary" onClick={() => nav.openToday()}>
                Open today's log
              </button>
              <button onClick={nav.capture}>Capture hours…</button>
            </>
          }
        >
          <p>
            In each day's log, add a project under <b>Work</b> with the day's hours (or quick capture <code>6h @project</code>), and list what you
            did under it. This grid fills in as you go.
          </p>
        </EmptyState>
      ) : (
        <>
          <section className="panel week-grid-panel">
            <table className="table week-grid">
              <thead>
                <tr>
                  <th>Project</th>
                  {week.days.map((d) => (
                    <th key={d} className={`num${isWeekend(d) ? " weekend" : ""}${d === t ? " today" : ""}`}>
                      <button className="link" onClick={() => nav.openLog(d)} title="Open this day's log">
                        {formatShort(d).replace(",", "")}
                      </button>
                    </th>
                  ))}
                  <th className="num">Total</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {week.rows.map((r) => (
                  <tr key={`${r.client}/${r.project ?? ""}`}>
                    <td>
                      <span className="week-label">{r.label}</span>
                      {r.project && <span className="muted small"> · {r.clientName}</span>}
                    </td>
                    {r.hours.map((h, i) => {
                      const n = r.items[i].length;
                      const missing = !h && n > 0;
                      return (
                        <td key={i} className={`num${isWeekend(week.days[i]) ? " weekend" : ""}${missing ? " missing" : ""}`}>
                          <span className="cell">
                            {missing ? (
                              <button className="link small" onClick={() => nav.openLog(week.days[i])} title="Work listed but no hours entered">
                                ?
                              </button>
                            ) : h ? (
                              <button className="cell-copy" onClick={() => copy(cell(h), `${cell(h)}h`)} title="Copy hours">
                                {cell(h)}
                              </button>
                            ) : null}
                            {n > 0 && (
                              <button
                                className="cell-tasks"
                                onClick={() => copyTasks(r, i)}
                                title={`Copy ${n} task${n === 1 ? "" : "s"} for ${r.label} on ${formatShort(week.days[i])}:\n${r.items[i].join("\n")}`}
                                aria-label={`Copy tasks for ${r.label} on ${formatShort(week.days[i])}`}
                              >
                                ☰
                              </button>
                            )}
                          </span>
                        </td>
                      );
                    })}
                    <td className="num week-total">{cell(r.total)}</td>
                    <td>
                      <button className="ghost small" onClick={() => copy(rowTsv(r), `${r.label} hours`)} title="This row's hours for the week, tab-separated">
                        Copy row
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td>Total</td>
                  {week.dayTotals.map((h, i) => (
                    <td key={i} className={`num${isWeekend(week.days[i]) ? " weekend" : ""}`}>
                      {cell(h)}
                    </td>
                  ))}
                  <td className="num week-total">{cell(week.total)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </section>

          {week.rows.map((r) => (
            <section key={`report-${r.client}/${r.project ?? ""}`} className="panel week-report">
              <div className="row-between">
                <h2>
                  {r.label}
                  {r.project && <span className="muted"> · {r.clientName}</span>} <span className="count">{cell(r.total) || 0}h</span>
                </h2>
                <button className="ghost small" onClick={() => copy(rowReport(week, r, style), `${r.label} report`)}>
                  Copy report
                </button>
              </div>
              {week.days.map((d, i) =>
                !r.items[i].length && !r.hours[i] ? null : (
                  <div key={d} className="week-day">
                    <div className="week-day-head">
                      <button className="link" onClick={() => nav.openLog(d)}>
                        {formatShort(d)}
                      </button>
                      <span className={`chip${r.hours[i] ? "" : " chip-warn"}`}>{r.hours[i] ? `${cell(r.hours[i])}h` : "no hours"}</span>
                      {r.items[i].length > 0 && (
                        <button className="small copy-tasks-btn" onClick={() => copyTasks(r, i)}>
                          Copy tasks
                        </button>
                      )}
                    </div>
                    {r.items[i].length ? (
                      <ul>
                        {r.items[i].map((x, j) => (
                          <li key={j}>{x}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="muted small">Nothing listed for this day.</p>
                    )}
                  </div>
                ),
              )}
            </section>
          ))}
        </>
      )}
    </div>
  );
}
