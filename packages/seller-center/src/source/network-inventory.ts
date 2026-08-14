import type { ShopSourceConfig } from "@shop-health/domain";
import { chromium } from "playwright-core";

import { AdsPowerClient } from "../adspower/client.js";
import { SellerCenterError } from "../errors.js";

const DEFAULT_DURATION_MS = 30_000;
const MIN_DURATION_MS = 1_000;
const MAX_DURATION_MS = 300_000;

const PAGINATION_KEYS = new Set([
  "cursor",
  "hasmore",
  "hasnext",
  "limit",
  "nextcursor",
  "nextcursortoken",
  "nextpage",
  "offset",
  "page",
  "pageindex",
  "pageno",
  "pagenumber",
  "pagesize",
  "searchnextcursor",
  "searchnexthasmore",
  "totalcount",
  "totalpages",
  "totalrecord",
]);

export interface NetworkInventoryReport {
  profileId: string;
  startedAt: Date;
  finishedAt: Date;
  durationMs: number;
  pageUrls: string[];
  entries: NetworkInventoryEntry[];
}

export interface NetworkInventoryEntry {
  method: string;
  host: string;
  path: string;
  status: number;
  contentType: string;
  topLevelKeys: string[];
  arrays: Array<{ path: string; count: number }>;
  pagination: Array<{
    path: string;
    value: number | boolean | "NULL" | string;
  }>;
  observations: number;
}

export interface CaptureSellerCenterNetworkInventoryOptions {
  baseUrl?: string;
  apiKey?: string;
  durationMs?: number;
  onReady?: (info: { pageUrls: string[] }) => void;
}

interface NetworkObservation {
  method: string;
  url: string;
  status: number;
  contentType: string;
  payload: unknown;
}

interface InventoryRequest {
  method(): string;
  resourceType(): string;
}

export interface InventoryResponse {
  request(): InventoryRequest;
  url(): string;
  status(): number;
  headers(): Record<string, string>;
  json(): Promise<unknown>;
}

export interface InventoryPage {
  url(): string;
  on(event: "response", listener: (response: InventoryResponse) => void): this;
  off(event: "response", listener: (response: InventoryResponse) => void): this;
}

export interface InventoryContext {
  pages(): InventoryPage[];
  on(event: "page", listener: (page: InventoryPage) => void): this;
  off(event: "page", listener: (page: InventoryPage) => void): this;
}

export interface InventoryBrowser {
  contexts(): InventoryContext[];
}

interface InventoryConnection {
  browser: InventoryBrowser;
  disconnect(): Promise<void>;
}

interface InventoryDependencies {
  createAdsPowerClient(options: { baseUrl?: string; apiKey?: string }): Pick<AdsPowerClient, "active">;
  connectOverCdp(endpoint: string): Promise<InventoryConnection>;
  now(): Date;
  sleep(durationMs: number): Promise<void>;
}

export async function captureSellerCenterNetworkInventory(
  config: ShopSourceConfig,
  options?: CaptureSellerCenterNetworkInventoryOptions,
): Promise<NetworkInventoryReport> {
  return captureSellerCenterNetworkInventoryWithDependencies(config, options, defaultDependencies);
}

export async function captureSellerCenterNetworkInventoryWithDependencies(
  config: ShopSourceConfig,
  options: CaptureSellerCenterNetworkInventoryOptions | undefined,
  dependencies: InventoryDependencies,
): Promise<NetworkInventoryReport> {
  const startedAt = dependencies.now();
  const durationMs = normalizeDurationMs(options?.durationMs);
  const clientOptions: { baseUrl?: string; apiKey?: string } = {};
  if (options?.baseUrl !== undefined) clientOptions.baseUrl = options.baseUrl;
  if (options?.apiKey !== undefined) clientOptions.apiKey = options.apiKey;

  const activeProfile = await dependencies.createAdsPowerClient(clientOptions).active(config.profileId);
  if (!activeProfile) {
    throw new SellerCenterError(
      "BROWSER_DISCONNECTED",
      `AdsPower profile ${config.profileId} is not already active`,
    );
  }

  const connection = await dependencies.connectOverCdp(activeProfile.cdpEndpoint);
  const accumulator = createNetworkInventoryAccumulator();
  const pageUrls = new Set<string>();
  const attachedPages = new Set<InventoryPage>();
  const pageListeners = new Map<InventoryPage, (response: InventoryResponse) => void>();
  const contextListeners = new Map<InventoryContext, (page: InventoryPage) => void>();
  const pendingResponses = new Set<Promise<void>>();
  let captureError: unknown;

  const attachPage = (page: InventoryPage): void => {
    if (attachedPages.has(page)) return;
    attachedPages.add(page);
    pageUrls.add(sanitizeUrl(page.url()));

    const listener = (response: InventoryResponse): void => {
      pageUrls.add(sanitizeUrl(page.url()));
      const task = collectResponse(response, accumulator).catch(() => undefined);
      pendingResponses.add(task);
      void task.then(() => pendingResponses.delete(task));
    };
    page.on("response", listener);
    pageListeners.set(page, listener);
  };

  try {
    for (const context of connection.browser.contexts()) {
      const pageListener = (page: InventoryPage): void => attachPage(page);
      context.on("page", pageListener);
      contextListeners.set(context, pageListener);
      for (const page of context.pages()) attachPage(page);
    }

    options?.onReady?.({ pageUrls: sorted(pageUrls) });
    await dependencies.sleep(durationMs);
    await Promise.allSettled([...pendingResponses]);

    const finishedAt = dependencies.now();
    return {
      profileId: config.profileId,
      startedAt,
      finishedAt,
      durationMs: Math.max(0, finishedAt.getTime() - startedAt.getTime()),
      pageUrls: sorted(pageUrls),
      entries: accumulator.entries(),
    };
  } catch (error) {
    captureError = error;
    throw error;
  } finally {
    for (const [context, listener] of contextListeners) context.off("page", listener);
    for (const [page, listener] of pageListeners) page.off("response", listener);
    await Promise.allSettled([...pendingResponses]);
    try {
      await connection.disconnect();
    } catch (error) {
      if (captureError === undefined) throw error;
    }
  }
}

export function summarizeNetworkObservation(observation: NetworkObservation): NetworkInventoryEntry {
  const url = new URL(observation.url);
  const arrays = new Map<string, number>();
  const pagination = new Map<string, number | boolean | "NULL" | string>();
  visitPayload(observation.payload, "", arrays, pagination);

  return {
    method: observation.method.toUpperCase(),
    host: url.hostname.toLowerCase(),
    path: url.pathname || "/",
    status: observation.status,
    contentType: normalizeContentType(observation.contentType),
    topLevelKeys: isRecord(observation.payload) ? Object.keys(observation.payload).sort() : [],
    arrays: [...arrays]
      .map(([path, count]) => ({ path, count }))
      .sort((left, right) => left.path.localeCompare(right.path)),
    pagination: [...pagination]
      .map(([path, value]) => ({ path, value }))
      .sort((left, right) => left.path.localeCompare(right.path)),
    observations: 1,
  };
}

export function createNetworkInventoryAccumulator(): {
  add(entry: NetworkInventoryEntry): void;
  entries(): NetworkInventoryEntry[];
} {
  const entriesByShape = new Map<string, NetworkInventoryEntry>();

  return {
    add(entry): void {
      const key = inventoryShapeKey(entry);
      const existing = entriesByShape.get(key);
      if (!existing) {
        entriesByShape.set(key, cloneEntry(entry));
        return;
      }
      existing.arrays = entry.arrays.map((item) => ({ ...item }));
      existing.pagination = entry.pagination.map((item) => ({ ...item }));
      existing.observations += entry.observations;
    },
    entries(): NetworkInventoryEntry[] {
      return [...entriesByShape.values()]
        .map(cloneEntry)
        .sort(compareEntries);
    },
  };
}

async function collectResponse(
  response: InventoryResponse,
  accumulator: ReturnType<typeof createNetworkInventoryAccumulator>,
): Promise<void> {
  const request = response.request();
  if (request.resourceType() !== "xhr" && request.resourceType() !== "fetch") return;

  const responseUrl = response.url();
  let url: URL;
  try {
    url = new URL(responseUrl);
  } catch {
    return;
  }
  if (!isTikTokSellerHost(url.hostname)) return;

  const contentType = contentTypeHeader(response.headers());
  if (!isJsonContentType(contentType)) return;

  const payload = await response.json();
  accumulator.add(summarizeNetworkObservation({
    method: request.method(),
    url: responseUrl,
    status: response.status(),
    contentType,
    payload,
  }));
}

function visitPayload(
  value: unknown,
  path: string,
  arrays: Map<string, number>,
  pagination: Map<string, number | boolean | "NULL" | string>,
): void {
  if (Array.isArray(value)) {
    const arrayPath = path || "$";
    arrays.set(arrayPath, Math.max(arrays.get(arrayPath) ?? 0, value.length));
    for (const item of value) visitPayload(item, `${arrayPath}[]`, arrays, pagination);
    return;
  }
  if (!isRecord(value)) return;

  for (const key of Object.keys(value).sort()) {
    const childPath = path ? `${path}.${key}` : key;
    const childValue = value[key];
    if (PAGINATION_KEYS.has(normalizeKey(key))) {
      const safeValue = sanitizePaginationValue(childValue);
      if (safeValue !== undefined) pagination.set(childPath, safeValue);
    }
    visitPayload(childValue, childPath, arrays, pagination);
  }
}

function sanitizePaginationValue(value: unknown): number | boolean | "NULL" | string | undefined {
  if (value === null) return "NULL";
  if (typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") return `PRESENT(length=${value.length})`;
  return undefined;
}

function inventoryShapeKey(entry: NetworkInventoryEntry): string {
  return JSON.stringify({
    method: entry.method,
    host: entry.host,
    path: entry.path,
    status: entry.status,
    contentType: entry.contentType,
    topLevelKeys: entry.topLevelKeys,
    arrayPaths: entry.arrays.map((item) => item.path),
    paginationPaths: entry.pagination.map((item) => item.path),
  });
}

function cloneEntry(entry: NetworkInventoryEntry): NetworkInventoryEntry {
  return {
    ...entry,
    topLevelKeys: [...entry.topLevelKeys],
    arrays: entry.arrays.map((item) => ({ ...item })),
    pagination: entry.pagination.map((item) => ({ ...item })),
  };
}

function compareEntries(left: NetworkInventoryEntry, right: NetworkInventoryEntry): number {
  return left.host.localeCompare(right.host)
    || left.path.localeCompare(right.path)
    || left.method.localeCompare(right.method)
    || left.status - right.status
    || left.contentType.localeCompare(right.contentType);
}

function normalizeDurationMs(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_DURATION_MS;
  return Math.min(MAX_DURATION_MS, Math.max(MIN_DURATION_MS, Math.trunc(value)));
}

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function normalizeContentType(value: string): string {
  return (value.split(";", 1)[0] ?? "").trim().toLowerCase();
}

function contentTypeHeader(headers: Record<string, string>): string {
  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() === "content-type") return value;
  }
  return "";
}

function isJsonContentType(value: string): boolean {
  const mediaType = normalizeContentType(value);
  return mediaType === "application/json" || mediaType.endsWith("+json");
}

function isTikTokSellerHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return /^seller(?:-[a-z0-9-]+)?\.tiktok\.com$/.test(host)
    || host === "seller.tiktokglobalshop.com"
    || host.endsWith(".seller.tiktokglobalshop.com");
}

function sanitizeUrl(value: string): string {
  try {
    const url = new URL(value);
    if (!url.host) return `${url.protocol}${url.pathname}`;
    return `${url.protocol}//${url.host}${url.pathname || "/"}`;
  } catch {
    return "UNAVAILABLE";
  }
}

function sorted(values: ReadonlySet<string>): string[] {
  return [...values].sort();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const defaultDependencies: InventoryDependencies = {
  createAdsPowerClient: (options) => new AdsPowerClient(options),
  connectOverCdp: async (endpoint) => {
    const browser = await chromium.connectOverCDP(endpoint);
    return {
      browser: browser as unknown as InventoryBrowser,
      // For connectOverCDP, Playwright closes its transport rather than the attached Chrome process.
      disconnect: async () => browser.close(),
    };
  },
  now: () => new Date(),
  sleep: async (durationMs) => new Promise((resolve) => setTimeout(resolve, durationMs)),
};
