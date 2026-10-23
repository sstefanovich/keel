/**
 * Pasting a link: names for the links an architect pastes most (Azure DevOps work items, PRs,
 * wiki pages and builds; the Azure portal; GitHub; SharePoint files), so they read well in notes.
 */

const decode = (s: string) => {
  try {
    return decodeURIComponent(s.replace(/\+/g, " "));
  } catch {
    return s;
  }
};

/** The URL if the text is exactly one http(s) link. */
export function singleUrl(text: string): string | null {
  const t = text.trim();
  if (!/^https?:\/\/\S+$/i.test(t)) return null;
  try {
    new URL(t);
    return t;
  } catch {
    return null;
  }
}

/** A readable name for a known kind of link, or null to fall back to the page title. */
export function knownLinkTitle(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase();
  const parts = u.pathname.split("/").filter(Boolean).map(decode);

  // Azure DevOps: dev.azure.com/{org}/{project}/… or {org}.visualstudio.com/{project}/…
  const ado = host === "dev.azure.com" ? parts.slice(1) : host.endsWith(".visualstudio.com") ? parts : null;
  if (ado) {
    const [project, area, ...rest] = ado;
    if (area === "_workitems") {
      const id = rest[0] === "edit" ? rest[1] : u.searchParams.get("id");
      if (id && /^\d+$/.test(id)) return `${project} #${id}`;
    }
    if (area === "_git") {
      const repo = rest[0];
      if (rest[1] === "pullrequest" && rest[2]) return `PR ${rest[2]} · ${repo}`;
      const path = u.searchParams.get("path");
      if (path && path !== "/") return `${repo}: ${path.split("/").filter(Boolean).pop()}`;
      if (repo) return `${repo} repo`;
    }
    if (area === "_wiki") {
      const pagePath = u.searchParams.get("pagePath");
      const page = pagePath ? pagePath.split("/").filter(Boolean).pop() : rest[rest.length - 1];
      if (page && !/^\d+$/.test(page)) return `${page.replace(/-/g, " ").replace(/%2D/gi, "-")} (wiki)`;
    }
    if (area === "_build") {
      const id = u.searchParams.get("buildId");
      if (id) return `Build ${id} · ${project}`;
    }
    if (area === "_release") {
      const id = u.searchParams.get("releaseId");
      if (id) return `Release ${id} · ${project}`;
    }
    return null;
  }

  // Azure portal: …/resource/subscriptions/{sub}/resourceGroups/{rg}[/providers/{ns}/{type}/{name}]
  if (host === "portal.azure.com" || host.endsWith(".portal.azure.com")) {
    const hash = decode(u.hash);
    const rg = /\/resourceGroups\/([^/]+)/i.exec(hash)?.[1];
    const res = /\/providers\/[^/]+\/[^/]+\/([^/]+)/i.exec(hash)?.[1];
    if (res && rg) return `${res} (${rg})`;
    if (rg) return `${rg} (resource group)`;
    return null;
  }

  // GitHub: pulls, issues, repos
  if (host === "github.com" && parts.length >= 2) {
    const [owner, repo, kind, n] = parts;
    if ((kind === "pull" || kind === "issues") && n && /^\d+$/.test(n)) return `${repo}#${n}`;
    if (parts.length === 2) return `${owner}/${repo}`;
    return null;
  }

  // SharePoint / OneDrive documents: the file name
  if (host.endsWith(".sharepoint.com")) {
    const id = u.searchParams.get("id");
    const file = (id ? decode(id) : u.pathname).split("/").filter(Boolean).pop();
    if (file && /\.[a-z0-9]{2,5}$/i.test(file)) return decode(file);
    return null;
  }
  return null;
}

/** Markdown link text can't contain unbalanced brackets. */
export function linkText(s: string): string {
  return s.replace(/[[\]]/g, (c) => (c === "[" ? "(" : ")")).trim();
}
