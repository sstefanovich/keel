import { useEffect, useRef } from "react";
import { Snippet } from "../core/parse";
import { copyText } from "../lib/platform";
import { useHold } from "./HoldContext";
import { mountMermaid } from "./mermaid";

export function MermaidDiagram({ code }: { code: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) mountMermaid(ref.current, code);
  }, [code]);
  return <div ref={ref} />;
}

/** A code block from a Chart: copyable command/config, or a rendered Mermaid diagram. */
export function SnippetBlock({ snippet }: { snippet: Snippet }) {
  const { toast } = useHold();
  if (snippet.lang === "mermaid") {
    return (
      <div className="snippet-block">
        {snippet.title && <div className="snippet-title">{snippet.title}</div>}
        <MermaidDiagram code={snippet.code} />
      </div>
    );
  }
  return (
    <div className="snippet-block">
      <div className="snippet-head">
        <span className="snippet-title">{snippet.title ?? (snippet.lang || "snippet")}</span>
        <button
          className="ghost small"
          onClick={async () => {
            await copyText(snippet.code);
            toast(`Copied ${snippet.title ?? "snippet"}`);
          }}
        >
          Copy
        </button>
      </div>
      <pre className="snippet-code">
        <code>{snippet.code}</code>
      </pre>
    </div>
  );
}
