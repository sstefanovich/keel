import { useState } from "react";
import { ISODate, addDays, addMonths, endOfMonth, formatShort, startOfMonth, startOfWeek, today } from "../../core/dates";
import { round2 } from "../../core/hold";
import { exportText } from "../../lib/platform";
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

export function TimesheetView() {
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
