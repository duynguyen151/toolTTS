import type { DatabaseContext, ShopRow } from "@shop-health/db";
import type { ProxyPreflightResult, SellerDataSource, SourceHealth, SyncRequest } from "@shop-health/domain";
import { SellerCenterError } from "@shop-health/seller-center/errors";
import type { Logger } from "pino";

import { runShopSync, type FinanceCompletionProof, type SyncResult } from "./index.js";

export type AuthoritativeRefreshResult =
  | {
      readonly status: "SUCCEEDED";
      readonly authoritativeProvider: "SELLER_CENTER";
      readonly sync: SyncResult;
      readonly financeProof: FinanceCompletionProof;
    }
  | {
      readonly status: "HUMAN_ACTION_REQUIRED";
      readonly authoritativeProvider: "SELLER_CENTER";
      readonly reason: "LOGIN_REQUIRED" | "CHALLENGE_REQUIRED";
    }
  | {
      readonly status: "BLOCKED";
      readonly authoritativeProvider: "SELLER_CENTER";
      readonly reason: "PROXY_UNKNOWN" | "PROXY_UNAVAILABLE";
    }
  | {
      readonly status: "FAILED";
      readonly authoritativeProvider: "SELLER_CENTER";
      readonly reason: string;
    };

export interface RunAuthoritativeFinanceRefreshInput {
  readonly context: DatabaseContext;
  readonly source: SellerDataSource;
  readonly shop: ShopRow;
  /** The refresh loop observes and persists this before entering the browser. */
  readonly preflight: ProxyPreflightResult;
  readonly checkpoint?: string | null;
  readonly logger?: Logger;
}

/**
 * Bounded W8 composition point. It has no business-write capability: successful
 * collection is delegated to the established finance sync path after its
 * canonical Seller Center identity proof.
 */
export async function runAuthoritativeFinanceRefresh(
  input: RunAuthoritativeFinanceRefreshInput,
): Promise<AuthoritativeRefreshResult> {
  if (input.preflight.status === "UNKNOWN" || input.preflight.status === "UNAVAILABLE") {
    return {
      status: "BLOCKED",
      authoritativeProvider: "SELLER_CENTER",
      reason: `PROXY_${input.preflight.status}`,
    };
  }

  const health = await input.source.health(sourceConfig(input.shop));
  const manualOutcome = manualOutcomeForHealth(health);
  if (manualOutcome !== null) return manualOutcome;
  if (health.status !== "HEALTHY") {
    return {
      status: "FAILED",
      authoritativeProvider: "SELLER_CENTER",
      reason: `SOURCE_${health.status}`,
    };
  }

  try {
    const sync = await runShopSync({
      context: input.context,
      source: input.source,
      shop: input.shop,
      kind: "finance",
      ...(input.checkpoint === undefined ? {} : { checkpoint: input.checkpoint }),
      ...(input.logger === undefined ? {} : { logger: input.logger }),
    });
    if (sync.status !== "SUCCEEDED" || !sync.complete || sync.financeProof === undefined) {
      return {
        status: "FAILED",
        authoritativeProvider: "SELLER_CENTER",
        reason: "FINANCE_RECONCILIATION_INCOMPLETE",
      };
    }
    return {
      status: "SUCCEEDED",
      authoritativeProvider: "SELLER_CENTER",
      sync,
      financeProof: sync.financeProof,
    };
  } catch (error) {
    const manualOutcome = manualOutcomeForError(error);
    if (manualOutcome !== null) return manualOutcome;
    return {
      status: "FAILED",
      authoritativeProvider: "SELLER_CENTER",
      reason: error instanceof SellerCenterError ? `SYNC_${error.failureType}` : "SYNC_UNEXPECTED_ERROR",
    };
  }
}

function sourceConfig(shop: ShopRow): SyncRequest["shop"] {
  if (shop.region !== "US" || shop.locale !== "en-US") {
    throw new Error(`Unsupported market ${shop.region}/${shop.locale}`);
  }
  return {
    shopId: shop.id,
    profileId: shop.profileId,
    profileNo: shop.profileNo,
    region: "US",
    locale: "en-US",
  };
}

function manualOutcomeForHealth(health: SourceHealth): Extract<AuthoritativeRefreshResult, { status: "HUMAN_ACTION_REQUIRED" }> | null {
  if (health.status !== "LOGIN_REQUIRED" && health.status !== "CHALLENGE_REQUIRED") return null;
  return {
    status: "HUMAN_ACTION_REQUIRED",
    authoritativeProvider: "SELLER_CENTER",
    reason: health.status,
  };
}

function manualOutcomeForError(error: unknown): Extract<AuthoritativeRefreshResult, { status: "HUMAN_ACTION_REQUIRED" }> | null {
  if (!(error instanceof SellerCenterError)) return null;
  if (error.failureType === "LOGIN_REQUIRED" || error.failureType === "AUTH_FAILED") {
    return { status: "HUMAN_ACTION_REQUIRED", authoritativeProvider: "SELLER_CENTER", reason: "LOGIN_REQUIRED" };
  }
  if (error.failureType === "CHALLENGE_REQUIRED") {
    return { status: "HUMAN_ACTION_REQUIRED", authoritativeProvider: "SELLER_CENTER", reason: "CHALLENGE_REQUIRED" };
  }
  return null;
}
