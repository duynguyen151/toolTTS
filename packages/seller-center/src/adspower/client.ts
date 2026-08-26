import { z } from "zod";

import {
  ProxyCapabilityResultSchema,
  resolveObservedStatusFromTags,
  type ProxyCapabilityResult,
} from "@shop-health/domain";
import { SellerCenterError } from "../errors.js";

const AdsPowerBrowserDataSchema = z.object({
  status: z.string().optional(),
  ws: z.object({ puppeteer: z.string().min(1) }).passthrough().optional(),
  debug_port: z.string().optional(),
}).passthrough();

const AdsPowerResponseSchema = z.object({
  code: z.number(),
  msg: z.string().optional(),
  data: AdsPowerBrowserDataSchema.optional(),
}).passthrough();

const AdsPowerReadinessResponseSchema = z.object({ code: z.number() }).passthrough();

const AdsPowerProfileListItemSchema = z.object({
  user_id: z.string().min(1),
  serial_number: z.union([z.string(), z.number()]).transform(String),
  group_name: z.string().nullable().optional(),
  fbcc_user_tag: z.array(z.object({
    name: z.string().trim(),
  })).nullable().optional(),
});

const AdsPowerProfileListResponseSchema = z.object({
  code: z.number(),
  msg: z.string().optional(),
  data: z.object({
    list: z.array(AdsPowerProfileListItemSchema),
  }).optional(),
});

const ProxyConfigSchema = z.object({
  proxy_soft: z.string().optional(),
});

const configuredProxySoftware = new Set([
  "brightdata",
  "brightauto",
  "oxylabsauto",
  "922s5auto",
  "ipfoxyauto",
  "922s5auth",
  "kookauto",
  "lumiproxyauto",
  "luminati",
  "ssh",
  "other",
]);

const AdsPowerProxyProfileResponseSchema = z.object({
  code: z.number(),
  data: z.object({
    list: z.array(z.object({
      user_id: z.string().min(1),
      user_proxy_config: ProxyConfigSchema.optional(),
      proxyid: z.union([z.string(), z.number()]).optional(),
    })),
  }).optional(),
});

const AdsPowerActiveListResponseSchema = z.object({
  code: z.number(),
  data: z.object({
    list: z.array(z.object({ user_id: z.string().min(1) })),
  }).optional(),
});

export interface AdsPowerClientOptions {
  baseUrl?: string;
  apiKey?: string;
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
}

export interface AdsPowerBrowserConnection {
  profileId: string;
  status: string;
  cdpEndpoint: string;
}

export type AdsPowerProfileState = "OPEN" | "CLOSED" | "ERROR";

export interface AdsPowerProfileSummary {
  profileId: string;
  profileNo: string;
  groupName: string | null;
  observedStatus?: "active" | "deactive" | "unknown" | null;
  state: AdsPowerProfileState;
}

export interface AdsPowerOpenReadyOptions {
  readyTimeoutMs?: number;
  pollIntervalMs?: number;
}

export class AdsPowerClient {
  private static readonly profileInventoryCacheMs = 2_000;
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof globalThis.fetch;
  private profileInventory: readonly AdsPowerProfileSummary[] | undefined;
  private profileInventoryExpiresAt = 0;
  private profileInventoryRequest: Promise<readonly AdsPowerProfileSummary[]> | undefined;

  constructor(options: AdsPowerClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? "http://127.0.0.1:50325").replace(/\/$/, "");
    this.apiKey = options.apiKey?.trim() || undefined;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
  }

  async active(profileId: string, timeoutMs?: number): Promise<AdsPowerBrowserConnection | null> {
    const response = await this.request("/api/v1/browser/active", profileId, timeoutMs);
    if (response.code !== 0 || !response.data?.ws?.puppeteer) return null;
    return {
      profileId,
      status: response.data.status ?? "Active",
      cdpEndpoint: response.data.ws.puppeteer,
    };
  }

  async probeReadiness(): Promise<boolean> {
    try {
      const response = AdsPowerReadinessResponseSchema.parse(await this.requestJson("/status", {}));
      return response.code === 0;
    } catch {
      return false;
    }
  }

  /** Read-only profile configuration seam; it does not test or start a proxy. */
  async getProxyCapability(
    profileId: string,
    options: { readonly timeoutMs?: number } = {},
  ): Promise<ProxyCapabilityResult> {
    try {
      const response = AdsPowerProxyProfileResponseSchema.parse(await this.requestJson(
        "/api/v1/user/list",
        { user_id: profileId, page: "1", page_size: "1" },
        options.timeoutMs,
      ));
      if (response.code !== 0 || response.data === undefined) {
        return ProxyCapabilityResultSchema.parse({ status: "UNAVAILABLE", reasonCode: "ADSPOWER_UNAVAILABLE" });
      }
      const profile = response.data.list.find((entry) => entry.user_id === profileId);
      if (profile === undefined) {
        return ProxyCapabilityResultSchema.parse({ status: "UNAVAILABLE", reasonCode: "ADSPOWER_UNAVAILABLE" });
      }
      const proxySoft = profile.user_proxy_config?.proxy_soft?.trim().toLowerCase();
      if (profile.proxyid !== undefined && String(profile.proxyid).trim() !== "") {
        return ProxyCapabilityResultSchema.parse({ status: "CONFIGURED", reasonCode: "PROXY_CONFIGURED" });
      }
      if (proxySoft !== undefined && proxySoft !== "") {
        if (proxySoft === "no_proxy") {
          return ProxyCapabilityResultSchema.parse({ status: "UNCONFIGURED", reasonCode: "PROXY_UNCONFIGURED" });
        }
        return ProxyCapabilityResultSchema.parse(configuredProxySoftware.has(proxySoft)
          ? { status: "CONFIGURED", reasonCode: "PROXY_CONFIGURED" }
          : { status: "UNAVAILABLE", reasonCode: "PROXY_UNKNOWN" });
      }
      return ProxyCapabilityResultSchema.parse({ status: "UNCONFIGURED", reasonCode: "PROXY_UNCONFIGURED" });
    } catch (error) {
      const reasonCode = error instanceof SellerCenterError
        && error.cause instanceof Error
        && error.cause.message === "AdsPower request deadline exceeded"
        ? "CAPABILITY_TIMEOUT"
        : "ADSPOWER_UNAVAILABLE";
      return ProxyCapabilityResultSchema.parse({ status: "UNAVAILABLE", reasonCode });
    }
  }

  async open(profileId: string): Promise<AdsPowerBrowserConnection> {
    const active = await this.active(profileId);
    if (active) return active;

    const response = await this.start(profileId);
    const cdpEndpoint = response.data?.ws?.puppeteer;
    if (response.code !== 0 || !cdpEndpoint) {
      throw new SellerCenterError(
        "PROFILE_START_FAILED",
        `AdsPower could not start profile ${profileId}: ${response.msg ?? `code ${response.code}`}`,
      );
    }
    return {
      profileId,
      status: response.data?.status ?? "Active",
      cdpEndpoint,
    };
  }

  async getProfileState(profileId: string): Promise<AdsPowerProfileState> {
    try {
      const response = await this.request("/api/v1/browser/active", profileId);
      if (response.code !== 0 || response.data === undefined) return "ERROR";
      return response.data?.ws?.puppeteer ? "OPEN" : "CLOSED";
    } catch {
      return "ERROR";
    }
  }

  async listProfiles(): Promise<AdsPowerProfileSummary[]> {
    if (this.profileInventory !== undefined && Date.now() < this.profileInventoryExpiresAt) {
      return [...this.profileInventory];
    }
    if (this.profileInventoryRequest !== undefined) {
      return [...await this.profileInventoryRequest];
    }

    const request = this.fetchProfileInventory();
    this.profileInventoryRequest = request;
    try {
      const profiles = await request;
      this.profileInventory = profiles;
      this.profileInventoryExpiresAt = Date.now() + AdsPowerClient.profileInventoryCacheMs;
      return [...profiles];
    } finally {
      if (this.profileInventoryRequest === request) this.profileInventoryRequest = undefined;
    }
  }

  private async fetchProfileInventory(): Promise<readonly AdsPowerProfileSummary[]> {
    const profiles: z.infer<typeof AdsPowerProfileListItemSchema>[] = [];
    let page = 1;

    while (true) {
      const response = AdsPowerProfileListResponseSchema.parse(await this.requestJson(
        "/api/v1/user/list",
        { page: String(page), page_size: "200" },
      ));
      if (response.code !== 0 || response.data === undefined) {
        throw new SellerCenterError(
          "ADSPOWER_UNAVAILABLE",
          `AdsPower could not list profiles: ${response.msg ?? `code ${response.code}`}`,
        );
      }

      profiles.push(...response.data.list);
      if (response.data.list.length !== 200) break;
      page += 1;
    }

    const activeIds = await this.listActiveProfileIds();
    return profiles.map((profile) => {
      const observedStatus = resolveObservedStatusFromTags((profile.fbcc_user_tag ?? []).map((tag) => tag.name));
      return {
        profileId: profile.user_id,
        profileNo: profile.serial_number,
        groupName: profile.group_name?.trim() || null,
        ...(observedStatus === null ? {} : { observedStatus }),
        state: activeIds === null ? "ERROR" : activeIds.has(profile.user_id) ? "OPEN" : "CLOSED",
      };
    });
  }

  async openReady(
    profileId: string,
    options: AdsPowerOpenReadyOptions = {},
  ): Promise<AdsPowerBrowserConnection> {
    const readyTimeoutMs = Math.max(options.readyTimeoutMs ?? 15_000, 0);
    const pollIntervalMs = Math.max(options.pollIntervalMs ?? 250, 0);
    const deadline = Date.now() + readyTimeoutMs;
    const sourceTimeout = () => new SellerCenterError(
      "SOURCE_TIMEOUT",
      `AdsPower profile ${profileId} did not become ready before the deadline`,
    );
    const withinReadyDeadline = async <T>(operation: (timeoutMs: number) => Promise<T>): Promise<T> => {
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) throw sourceTimeout();
      try {
        return await operation(Math.min(this.timeoutMs, remainingMs));
      } catch (error) {
        if (Date.now() >= deadline) throw sourceTimeout();
        throw error;
      }
    };

    const active = await withinReadyDeadline((timeoutMs) => this.active(profileId, timeoutMs));
    if (active) return active;

    const response = await withinReadyDeadline((timeoutMs) => (
      this.start(profileId, timeoutMs)
    ));
    if (response.code !== 0) {
      throw new SellerCenterError(
        "PROFILE_START_FAILED",
        `AdsPower could not start profile ${profileId}: ${response.msg ?? `code ${response.code}`}`,
      );
    }
    if (response.data?.ws?.puppeteer) {
      return {
        profileId,
        status: response.data.status ?? "Active",
        cdpEndpoint: response.data.ws.puppeteer,
      };
    }

    while (Date.now() < deadline) {
      if (pollIntervalMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, Math.min(pollIntervalMs, deadline - Date.now())));
      }
      const connection = await withinReadyDeadline((timeoutMs) => this.active(profileId, timeoutMs));
      if (connection) return connection;
    }

    throw sourceTimeout();
  }

  private async listActiveProfileIds(): Promise<Set<string> | null> {
    try {
      const response = AdsPowerActiveListResponseSchema.parse(
        await this.requestJson("/api/v1/browser/local-active", {}),
      );
      if (response.code !== 0 || response.data === undefined) return null;
      return new Set(response.data.list.map((profile) => profile.user_id));
    } catch {
      return null;
    }
  }

  private async request(
    path: string,
    profileId: string,
    timeoutMs?: number,
  ): Promise<z.infer<typeof AdsPowerResponseSchema>> {
    return AdsPowerResponseSchema.parse(await this.requestJson(path, { user_id: profileId }, timeoutMs));
  }

  private async start(
    profileId: string,
    timeoutMs?: number,
  ): Promise<z.infer<typeof AdsPowerResponseSchema>> {
    return AdsPowerResponseSchema.parse(await this.requestJson(
      "/api/v1/browser/start",
      { user_id: profileId, password_filling: "1" },
      timeoutMs,
    ));
  }

  private async requestJson(
    path: string,
    params: Record<string, string>,
    timeoutMs = this.timeoutMs,
  ): Promise<unknown> {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
    if (this.apiKey) url.searchParams.set("api_key", this.apiKey);

    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        this.fetchImpl(url, { signal: controller.signal }).then(async (response) => {
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          return response.json();
        }),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => {
            controller.abort();
            reject(new Error("AdsPower request deadline exceeded"));
          }, Math.max(timeoutMs, 0));
        }),
      ]);
    } catch (error) {
      if (error instanceof SellerCenterError) throw error;
      throw new SellerCenterError(
        "ADSPOWER_UNAVAILABLE",
        `AdsPower Local API request failed for ${path}`,
        { cause: error },
      );
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
    }
  }
}
