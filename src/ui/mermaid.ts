/** Lazy Mermaid rendering with a small cache (the library is large, so it loads on first diagram). */

type Mermaid = typeof import("mermaid").default;

let lib: Promise<Mermaid> | null = null;
let n = 0;
const cache = new Map<string, Promise<string>>();

const dark = () => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;

function load(): Promise<Mermaid> {
  lib ??= import("mermaid").then((m) => {
    m.default.initialize({ startOnLoad: false, securityLevel: "strict", theme: dark() ? "dark" : "default", fontFamily: "Segoe UI, sans-serif" });
    return m.default;
  });
  return lib;
}

/** Resolves to SVG markup; rejects with Mermaid's parse error message. */
export function renderMermaid(code: string): Promise<string> {
  const key = `${dark()}|${code}`;
  let p = cache.get(key);
  if (!p) {
    p = load().then(async (m) => (await m.render(`keel-mmd-${++n}`, code)).svg);
    p.catch(() => cache.delete(key));
    cache.set(key, p);
    if (cache.size > 100) cache.delete(cache.keys().next().value!);
  }
  return p;
}

/** Fill `el` with the diagram (or an error box). */
export function mountMermaid(el: HTMLElement, code: string) {
  el.classList.add("mermaid-box");
  el.textContent = "Rendering diagram…";
  renderMermaid(code)
    .then((svg) => {
      el.innerHTML = svg;
    })
    .catch((e) => {
      el.classList.add("mermaid-error");
      el.textContent = `Diagram error: ${e instanceof Error ? e.message : String(e)}`.slice(0, 400);
    });
}
