import { z } from "zod";
import type { CotikAccountHealthState } from "@shop-health/domain";

import {
  createCotikClient,
  CotikClientError,
  type CotikClient,
  type CotikClientOptions
} from "./client.js";

export interface MultiAccountClientOptions {
  readonly accountId: string;
  readonly token: string;
  readonly baseUrl?: string | undefined;
  readonly fetch?: typeof globalThis.fetch | undefined;
  readonly sleep?: ((durationMs: number) => Promise<void>) | undefined;
  readonly timeoutMs?: number | undefined;
  readonly now?: (() => number) | undefined;
  readonly beforePost?: (() => Promise<void>) | undefined;
}

export function classifyCotikAccountHealth(error: unknown): {
  state: CotikAccountHealthState;
  message: string;
} {
  if (!error) {
    return { state: "ACTIVE", message: "Account is active and operational" };
  }

  const rawMessage = error instanceof Error ? error.message : String(error);

  // Use applicationMessage from CotikClientError for reliable classification
  // These match the exact messages documented in public-api-guide.md §2
  if (error instanceof CotikClientError && error.applicationMessage) {
    const appMsg = error.applicationMessage.toLowerCase();

    if (appMsg.includes("token is not valid") || appMsg.includes("token has expired")) {
      return { state: "TOKEN_EXPIRED", message: "Cotik authentication token is invalid or expired" };
    }
    if (appMsg.includes("has been block")) {
      return { state: "BLOCKED", message: "Cotik account has been blocked" };
    }
    if (appMsg.includes("service has expired") || appMsg.includes("please upgrade")) {
      return { state: "SUBSCRIPTION_EXPIRED", message: "Cotik subscription or service has expired" };
    }
    if (appMsg.includes("connect shop") || appMsg.includes("do not have permission")) {
      return { state: "SHOP_DISCONNECTED", message: "Shop is disconnected or insufficient permissions" };
    }
  }

  const lower = rawMessage.toLowerCase();

  // Check token expiration
  if (
    lower.includes("token is not valid") ||
    lower.includes("token expired") ||
    lower.includes("token has expired") ||
    lower.includes("invalid token") ||
    (error instanceof CotikClientError && error.httpStatus === 401)
  ) {
    return { state: "TOKEN_EXPIRED", message: "Cotik authentication token is invalid or expired" };
  }

  // Check blocked account
  if (lower.includes("has been block") || lower.includes("blocked") || lower.includes("account is locked")) {
    return { state: "BLOCKED", message: "Cotik account has been blocked or locked" };
  }

  // Check subscription expiration
  if (
    lower.includes("service has expired") ||
    lower.includes("subscription has expired") ||
    lower.includes("subscription expired") ||
    lower.includes("membership expired") ||
    lower.includes("please upgrade")
  ) {
    return { state: "SUBSCRIPTION_EXPIRED", message: "Cotik subscription or service has expired" };
  }

  // Check shop disconnected
  if (
    lower.includes("shop/app not found") ||
    lower.includes("shop not found") ||
    lower.includes("shop disconnected") ||
    lower.includes("app not found") ||
    lower.includes("connect shop")
  ) {
    return { state: "SHOP_DISCONNECTED", message: "Shop is disconnected or not found in Cotik account" };
  }

  // Check rate limit
  if (
    lower.includes("too many requests") ||
    lower.includes("rate limit") ||
    (error instanceof CotikClientError && (error.httpStatus === 429 || error.applicationStatus === 429))
  ) {
    return { state: "RATE_LIMITED", message: "Cotik rate limit exceeded" };
  }

  // Check network error or timeout
  if (
    error instanceof CotikClientError &&
    (error.code === "NETWORK" || error.code === "TIMEOUT")
  ) {
    return { state: "NETWORK_ERROR", message: "Network connection to Cotik failed or timed out" };
  }

  if (lower.includes("timeout") || lower.includes("econnrefused") || lower.includes("fetch failed")) {
    return { state: "NETWORK_ERROR", message: "Network connection to Cotik failed or timed out" };
  }

  return { state: "UNKNOWN", message: "Cotik encountered an unexpected error" };
}

export interface MultiAccountCotikClient {
  readonly accountId: string;
  get<T = unknown>(path: string, dataSchema?: z.ZodType<T>): Promise<T>;
  post<T = unknown>(path: string, body: unknown, dataSchema?: z.ZodType<T>): Promise<T>;
  diagnoseHealth(error: unknown): { state: CotikAccountHealthState; message: string };
}

export function createMultiAccountCotikClient(
  options: MultiAccountClientOptions
): MultiAccountCotikClient {
  if (!options.accountId || !options.accountId.trim()) {
    throw new Error("accountId is required");
  }
  if (!options.token || !options.token.trim()) {
    throw new Error("token is required");
  }

  const clientOptions: CotikClientOptions = {
    token: options.token,
    ...(options.baseUrl !== undefined ? { baseUrl: options.baseUrl } : {}),
    ...(options.fetch !== undefined ? { fetch: options.fetch } : {}),
    ...(options.sleep !== undefined ? { sleep: options.sleep } : {}),
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    ...(options.now !== undefined ? { now: options.now } : {}),
    ...(options.beforePost !== undefined ? { beforePost: options.beforePost } : {})
  };

  const client: CotikClient = createCotikClient(clientOptions);

  return {
    accountId: options.accountId,
    async get<T = unknown>(path: string, dataSchema?: z.ZodType<T>): Promise<T> {
      return await client.get<T>(path, dataSchema);
    },
    async post<T = unknown>(path: string, body: unknown, dataSchema?: z.ZodType<T>): Promise<T> {
      if (!client.post) {
        throw new Error("Cotik client does not support POST");
      }
      return await client.post<T>(path, body, dataSchema);
    },
    diagnoseHealth(error: unknown) {
      return classifyCotikAccountHealth(error);
    }
  };
}
