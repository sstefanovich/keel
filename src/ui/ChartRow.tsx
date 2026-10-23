import { ChartItem } from "../core/parse";
import { copyText, openUrl } from "../lib/platform";
import { useHold } from "./HoldContext";

function prettyHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function prettyPath(url: string): string {
  try {
    const u = new URL(url);
    const p = decodeURIComponent(u.pathname).replace(/\/$/, "");
    return p || (u.hash ? decodeURIComponent(u.hash).slice(0, 60) : "");
  } catch {
    return "";
  }
}

/** One reference row: label, value (click to copy), open button for URLs. */
export function ChartRow({ item, context, onContext, portalUrl }: { item: ChartItem; context?: string; onContext?: () => void; portalUrl?: string }) {
  const { toast, reportError } = useHold();
  const copy = async () => {
    await copyText(item.value);
    toast(`Copied ${item.label ?? item.value.slice(0, 40)}`);
  };
  // a row that's just a link reads as one: the site and path, opened on click (Copy still copies it)
  const urlOnly = !!item.url && item.value.trim() === item.url;
  return (
    <div className="chart-row" style={{ paddingLeft: 10 + Math.min(item.indent, 8) * 6 }}>
      {item.label && <span className="chart-label">{item.label}</span>}
      {urlOnly ? (
        <button className="chart-value chart-link" onClick={() => openUrl(item.url!).catch(reportError)} title={`Open ${item.url}`}>
          <span className="chart-link-host">{prettyHost(item.url!)}</span>
          <span className="chart-link-path">{prettyPath(item.url!)}</span> ↗
        </button>
      ) : (
        <button className="chart-value" onClick={copy} title="Click to copy">
          {item.value}
        </button>
      )}
      {context && (
        <button className="link small chart-context" onClick={onContext}>
          {context}
        </button>
      )}
      {portalUrl && (
        <button className="portal-btn small" onClick={() => openUrl(portalUrl).catch(reportError)} title={`Open in the Azure portal\n${portalUrl}`}>
          Portal ↗
        </button>
      )}
      <span className="chart-actions">
        {item.url && !urlOnly && (
          <button className="ghost small" onClick={() => openUrl(item.url!).catch(reportError)} title={`Open ${item.url}`}>
            Open
          </button>
        )}
        <button className="ghost small" onClick={copy} title="Copy">
          Copy
        </button>
      </span>
    </div>
  );
}
