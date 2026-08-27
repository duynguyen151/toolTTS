import type { ProxyPreflight, ProxyPreflightResult } from "@shop-health/domain";

export const AUTOMATIC_ORDERS_PREFLIGHT_BLOCKED_MESSAGE = "Automatic Orders refresh blocked by proxy preflight";

export interface AutomaticOrdersPreflightResult {
  readonly preflightStatus: ProxyPreflightResult["status"];
  readonly browserExecuted: boolean;
  readonly succeeded: boolean;
}

export async function runAutomaticOrdersWithPreflight<TShop extends { readonly id: string; readonly profileId: string }>(input: {
  readonly shop: TShop;
  readonly proxyPreflight: ProxyPreflight;
  readonly execute: (shop: TShop) => Promise<boolean>;
  readonly logBlocked: (event: {
    readonly operation: "worker.orders.proxy_preflight";
    readonly entity: "orders";
    readonly shopId: string;
    readonly profileId: string;
    readonly status: "UNKNOWN" | "UNAVAILABLE";
  }, message: string) => void;
}): Promise<AutomaticOrdersPreflightResult> {
  let status: ProxyPreflightResult["status"] = "UNKNOWN";
  try {
    status = (await input.proxyPreflight.preflight({ profileId: input.shop.profileId })).status;
  } catch {
    // A missing safe observation must never permit browser work.
  }
  if (status === "HEALTHY" || status === "DEGRADED") {
    return { preflightStatus: status, browserExecuted: true, succeeded: await input.execute(input.shop) };
  }
  input.logBlocked({
    operation: "worker.orders.proxy_preflight",
    entity: "orders",
    shopId: input.shop.id,
    profileId: input.shop.profileId,
    status,
  }, AUTOMATIC_ORDERS_PREFLIGHT_BLOCKED_MESSAGE);
  return { preflightStatus: status, browserExecuted: false, succeeded: false };
}
