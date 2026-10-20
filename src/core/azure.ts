import { ChartItem } from "./parse";

const GUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

export interface AzureContext {
  /** Tenant domain or ID, e.g. contoso.onmicrosoft.com */
  tenant?: string;
  /** Subscription ID (GUID) */
  subscription?: string;
}

const isTenant = (i: ChartItem) => /\b(tenant|directory)\b/i.test(i.label ?? "");
const isSubscription = (i: ChartItem) => /\bsub(scription)?\b/i.test(i.label ?? "") && GUID.test(i.value);

function tenantValue(v: string): string {
  return v.match(GUID)?.[0] ?? v.split(/[\s(]/)[0];
}

/**
 * Tenant and subscription that apply to the chart item on `line`: the nearest
 * Subscription above it (else the first in the file), then the parent client's.
 */
export function azureContext(items: ChartItem[], line: number, fallback: ChartItem[] = []): AzureContext {
  const pick = (list: ChartItem[], test: (i: ChartItem) => boolean, before?: number) => {
    const matches = list.filter(test);
    const above = before === undefined ? [] : matches.filter((i) => i.line < before);
    return (above.length ? above[above.length - 1] : matches[0])?.value;
  };
  const tenant = pick(items, isTenant, line) ?? pick(fallback, isTenant);
  const sub = pick(items, isSubscription, line) ?? pick(fallback, isSubscription);
  return {
    tenant: tenant ? tenantValue(tenant) : undefined,
    subscription: sub?.match(GUID)?.[0],
  };
}

export function isResourceGroup(item: ChartItem): boolean {
  return /resource\s*group|^rg$/i.test(item.label ?? "") || /^rg[-_]/i.test(item.value);
}

/** Azure portal link for a resource group or a full resource ID, if enough is known. */
export function azurePortalUrl(item: ChartItem, ctx: AzureContext): string | undefined {
  const base = `https://portal.azure.com/#${ctx.tenant ? `@${ctx.tenant}/` : ""}resource`;
  const id = item.value.match(/\/subscriptions\/[0-9a-f-]{36}\/[^\s`]+/i)?.[0];
  if (id) return `${base}${id.replace(/\/+$/, "")}`;
  if (isResourceGroup(item) && ctx.subscription) {
    const rg = item.value.match(/[\w.()-]+/)?.[0];
    if (rg) return `${base}/subscriptions/${ctx.subscription}/resourceGroups/${rg}/overview`;
  }
  return undefined;
}
