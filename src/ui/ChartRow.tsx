import { ChartItem } from "../core/parse";
import { copyText, openUrl } from "../lib/platform";
import { useHold } from "./HoldContext";

/** One reference row: label, value (click to copy), open button for URLs. */
export function ChartRow({ item, context, onContext, portalUrl }: { item: ChartItem; context?: string; onContext?: () => void; portalUrl?: string }) {
  const { toast, reportError } = useHold();
  const copy = async () => {
    await copyText(item.value);
    toast(`Copied ${item.label ?? item.value.slice(0, 40)}`);
  };
  return (
    <div className="chart-row" style={{ paddingLeft: 10 + Math.min(item.indent, 8) * 6 }}>
      {item.label && <span className="chart-label">{item.label}</span>}
      <button className="chart-value" onClick={copy} title="Click to copy">
        {item.value}
      </button>
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
        {item.url && (
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
