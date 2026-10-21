import { ReactNode, useState } from "react";
import { ISODate, addDays, addMonths, endOfMonth, formatShort, startOfMonth, startOfWeek, today } from "../../core/dates";
import { round2 } from "../../core/hold";
import { copyText, exportText } from "../../lib/platform";
import { buildWeek, dayItems, rowReport, rowTsv, weekTsv } from "../../core/week";
import { useHold } from "../HoldContext";
import { useNav } from "../nav";

type Preset = "this-week" | "last-week" | "this-month" | "last-month" | "this-year" | "custom";

function rangeFor(p: Preset, d: ISODate): [ISODate, ISODate] {
  switch (p) {
    case "this-week":
      return [startOfWeek(d), addDays(startOfWeek(d), 6)];
    case "last-week":
      return [addDays(startOfWeek(d), -7), addDays(startOfWeek(d), -1)];
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

function money(n: number, currency: string) {
  try {
    return n.toLocaleString(undefined, { style: "currency", currency });
  } catch {
    return `${round2(n)} ${currency}`;
  }
}

function TotalsView({ toggle }: { toggle: ReactNode }) {
  const { hold, bump, reportError, toast, focus } = useHold();
  const nav = useNav();
  const [preset, setPreset] = useState<Preset>("this-week");
  const [custom, setCustom] = useState<[ISODate, ISODate]>(() => rangeFor("this-month", today()));
  const [from, to] = preset === "custom" ? custom : rangeFor(preset, today());
  const ts = hold.timesheet(from, to, focus);

  const currencies = new Set(ts.byClient.filter((c) => c.client.rate).map((c) => c.client.currency));
  const billable = ts.byClient.reduce((s, c) => s + c.amount, 0);

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
          <span className="stat-label">Billable</span>
          <span className="stat-value">
            {currencies.size === 1 ? money(billable, [...currencies][0]) : currencies.size ? "mixed currencies" : "—"}
          </span>
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
        <p className="empty panel">
          No hours in this period. Log them in a daily log as <code>- 2.5h @client what you did</code>, or press Ctrl+K.
        </p>
      ) : (
        <>
          <section className="panel">
            <h2>By client</h2>
            <table className="table">
              <thead>
                <tr>
                  <th>Client</th>
                  <th className="num">Hours</th>
                  <th className="num">Rate</th>
                  <th className="num">Amount</th>
                </tr>
              </thead>
              <tbody>
                {ts.byClient.map(({ client, hours, amount }) => (
                  <tr key={client.key}>
                    <td>
                      {client.path ? (
                        <button className="link" onClick={() => nav.openFile(client.path!)}>
                          {client.name}
                        </button>
                      ) : (
                        <>
                          @{client.key}{" "}
                          <button className="link small" onClick={() => createClient(client.key)}>
                            set rate
                          </button>
                        </>
                      )}
                    </td>
                    <td className="num">{fmtHours(hours)}</td>
                    <td className="num">{client.rate ? money(client.rate, client.currency) : "—"}</td>
                    <td className="num">{client.rate ? money(amount, client.currency) : "—"}</td>
                  </tr>
                ))}
              </tbody>
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
  const [monday, setMonday] = useState(() => startOfWeek(today()));
  const week = buildWeek(hold, monday, focus);
  const t = today();

  const copy = async (text: string, what: string) => {
    await copyText(text);
    toast(`Copied ${what}`);
  };

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
          <button onClick={() => setMonday(addDays(monday, -7))} aria-label="Previous week">
            ‹
          </button>
          <button onClick={() => setMonday(startOfWeek(t))}>This week</button>
          <button onClick={() => setMonday(addDays(monday, 7))} aria-label="Next week">
            ›
          </button>
          <button onClick={() => copy(weekTsv(week), "the week grid")} disabled={!week.rows.length} title="Tab-separated, pastes into Excel or a form grid">
            Copy grid
          </button>
        </div>
      </header>

      {!week.rows.length ? (
        <p className="empty panel">
          No work logged this week. In each day's log, add a project under <b>Work</b> (or quick capture <code>6h @project</code>), then list
          what you did under it.
        </p>
      ) : (
        <>
          <section className="panel week-grid-panel">
            <table className="table week-grid">
              <thead>
                <tr>
                  <th>Project</th>
                  {week.days.map((d, i) => (
                    <th key={d} className={`num${i >= 5 ? " weekend" : ""}${d === t ? " today" : ""}`}>
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
                      const missing = !h && r.items[i].length > 0;
                      return (
                        <td key={i} className={`num${i >= 5 ? " weekend" : ""}${missing ? " missing" : ""}`}>
                          {missing ? (
                            <button className="link small" onClick={() => nav.openLog(week.days[i])} title="Work listed but no hours entered">
                              ?
                            </button>
                          ) : h ? (
                            <button className="cell-copy" onClick={() => copy(cell(h), `${cell(h)}h`)} title="Click to copy">
                              {cell(h)}
                            </button>
                          ) : null}
                        </td>
                      );
                    })}
                    <td className="num week-total">{cell(r.total)}</td>
                    <td>
                      <button className="ghost small" onClick={() => copy(rowTsv(r), `${r.label} hours`)} title="Mon–Sun hours, tab-separated">
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
                    <td key={i} className={`num${i >= 5 ? " weekend" : ""}`}>
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
                <button className="ghost small" onClick={() => copy(rowReport(week, r), `${r.label} report`)}>
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
                        <button className="ghost small" onClick={() => copy(dayItems(r, i), `${formatShort(d)} items`)}>
                          Copy day
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
