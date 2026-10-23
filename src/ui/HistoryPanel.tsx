import { History, RotateCcw, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { DiffLine, diffLines, diffStats } from "../core/diff";
import { FileVersion, confirmDialog, historyRead, historyVersions } from "../lib/platform";
import { flushEditors } from "./editor/Editor";
import { snapshotNow } from "./history";
import { useHold } from "./HoldContext";

function when(ms: number): string {
  const d = new Date(ms);
  const sameDay = d.toDateString() === new Date().toDateString();
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return sameDay ? `Today ${time}` : `${d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" })} ${time}`;
}

/** Only the changed lines, with a few lines of context around each change. */
function hunks(d: DiffLine[], context = 3): (DiffLine | { kind: "gap"; n: number })[] {
  const keep = d.map(() => false);
  d.forEach((l, i) => {
    if (l.kind !== "same") for (let k = Math.max(0, i - context); k <= Math.min(d.length - 1, i + context); k++) keep[k] = true;
  });
  const out: (DiffLine | { kind: "gap"; n: number })[] = [];
  let gap = 0;
  d.forEach((l, i) => {
    if (keep[i]) {
      if (gap) out.push({ kind: "gap", n: gap });
      gap = 0;
      out.push(l);
    } else gap++;
  });
  if (gap) out.push({ kind: "gap", n: gap });
  return out;
}

/**
 * A file's earlier versions from the automatic snapshots: pick one to see what changed since, and
 * restore it if needed (the current text is snapshotted first, so a restore can be undone too).
 */
export function HistoryPanel({ path, onClose }: { path: string; onClose: () => void }) {
  const { hold, dir, bump, reportError, toast } = useHold();
  const [versions, setVersions] = useState<FileVersion[] | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [old, setOld] = useState<string | null>(null);
  const [current, setCurrent] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    void (async () => {
      await flushEditors();
      // record the latest edits so the newest version is in the list too
      await snapshotNow();
      const [vs, cur] = await Promise.all([historyVersions(dir, path), hold.fs.read(path).catch(() => "")]);
      setCurrent(cur);
      setVersions(vs);
      // the newest snapshot is usually the current text, so start on the one before it
      setSel((vs[1] ?? vs[0])?.id ?? null);
    })().catch(reportError);
  }, [dir, path, hold, reportError]);

  useEffect(() => {
    if (!sel) return setOld(null);
    setOld(null);
    historyRead(dir, sel, path)
      .then((t) => setOld(t ?? ""))
      .catch(reportError);
  }, [sel, dir, path, reportError]);

  const diff = useMemo(() => (old === null ? null : diffLines(old, current)), [old, current]);
  const stats = diff ? diffStats(diff) : null;
  const selected = versions?.find((v) => v.id === sel);
  const same = !!diff && stats!.added === 0 && stats!.removed === 0;

  const restore = async () => {
    if (old === null || !selected) return;
    if (!(await confirmDialog(`Restore “${hold.get(path)?.title ?? path}” as it was ${when(selected.time)}? The current text stays in the history.`, "Restore"))) return;
    setBusy(true);
    try {
      await flushEditors();
      await snapshotNow("Before restoring an earlier version");
      await hold.save(path, old);
      await snapshotNow(`Restored ${path}`);
      bump();
      toast("Restored the earlier version");
      onClose();
    } catch (e) {
      reportError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal history-modal" role="dialog" aria-label="File history" onMouseDown={(e) => e.stopPropagation()}>
        <header className="history-head">
          <History size={16} aria-hidden="true" />
          <h2>History · {hold.get(path)?.title ?? path}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={16} aria-hidden="true" />
          </button>
        </header>
        {versions === null ? (
          <p className="muted">Loading…</p>
        ) : versions.length === 0 ? (
          <p className="muted">
            No earlier versions yet. Keel saves a snapshot of your files every 10 minutes while it's running (Settings → File history).
          </p>
        ) : (
          <div className="history-body">
            <ul className="history-list" role="listbox" aria-label="Versions">
              {versions.map((v, i) => (
                <li key={v.id}>
                  <button role="option" aria-selected={v.id === sel} className={v.id === sel ? "on" : ""} onClick={() => setSel(v.id)}>
                    <span>{when(v.time)}</span>
                    <span className="muted small">{i === 0 && !v.deleted ? "latest snapshot" : v.deleted ? "deleted" : v.message.startsWith("Keel snapshot") ? "" : v.message}</span>
                  </button>
                </li>
              ))}
            </ul>
            <div className="history-view">
              {selected && diff && (
                <div className="history-bar">
                  <span className="small">
                    {same ? (
                      "Same as now"
                    ) : (
                      <>
                        Changes since then: <span className="diff-add-count">+{stats!.added}</span> <span className="diff-del-count">−{stats!.removed}</span> lines
                      </>
                    )}
                  </span>
                  <span className="spacer" />
                  <button className="primary" onClick={restore} disabled={busy || same || selected.deleted}>
                    <RotateCcw size={14} aria-hidden="true" /> Restore this version
                  </button>
                </div>
              )}
              <pre className="history-diff" aria-label="Differences: removed lines were in that version, added lines are in the current file">
                {diff === null
                  ? "Loading…"
                  : hunks(diff).map((l, i) =>
                      l.kind === "gap" ? (
                        <div key={i} className="diff-gap">
                          ⋯ {l.n} unchanged line{l.n === 1 ? "" : "s"}
                        </div>
                      ) : (
                        <div key={i} className={`diff-${l.kind}`}>
                          <span className="diff-sign">{l.kind === "add" ? "+" : l.kind === "del" ? "−" : " "}</span>
                          {l.text || " "}
                        </div>
                      ),
                    )}
              </pre>
              <p className="muted small">− lines are in that version only · + lines were added since</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
