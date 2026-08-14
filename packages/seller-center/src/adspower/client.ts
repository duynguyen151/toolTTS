import { z } from "zod";

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

export class AdsPowerClient {
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof globalThis.fetch;

  constructor(options: AdsPowerClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? "http://127.0.0.1:50325").replace(/\/$/, "");
    this.apiKey = options.apiKey?.trim() || undefined;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
  }

  async active(profileId: string): Promise<AdsPowerBrowserConnection | null> {
    const response = await this.request("/api/v1/browser/active", profileId);
    if (response.code !== 0 || !response.data?.ws?.puppeteer) return null;
    return {
      profileId,
      status: response.data.status ?? "Active",
      cdpEndpoint: response.data.ws.puppeteer,
    };
  }

  async open(profileId: string): Promise<AdsPowerBrowserConnection> {
    const active = await this.active(profileId);
    if (active) return active;

    const response = await this.request("/api/v1/browser/start", profileId);
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

  private async request(path: string, profileId: string): Promise<z.infer<typeof AdsPowerResponseSchema>> {
    const url = new URL(`${this.baseUrl}${path}`);
    url.searchParams.set("user_id", profileId);
    if (this.apiKey) url.searchParams.set("api_key", this.apiKey);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(url, { signal: controller.signal });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return AdsPowerResponseSchema.parse(await response.json());
    } catch (error) {
      if (error instanceof SellerCenterError) throw error;
      throw new SellerCenterError(
        "ADSPOWER_UNAVAILABLE",
        `AdsPower Local API request failed for profile ${profileId}`,
        { cause: error },
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}
