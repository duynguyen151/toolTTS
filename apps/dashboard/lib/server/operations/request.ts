import { isIP } from "node:net";

import type { OperationError } from "../../operations-contract.js";

const PROFILE_NO_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const LOCAL_HOSTNAMES = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

export type LocalProfileRequestResult =
  | { readonly ok: true; readonly profileNo: string }
  | { readonly ok: false; readonly status: 400 | 403; readonly error: OperationError };

function isLocalHostname(hostname: string): boolean {
  return LOCAL_HOSTNAMES.has(hostname.toLowerCase());
}

function forwardedAddresses(request: Request): string[] {
  const addresses = request.headers.get("x-forwarded-for")?.split(",") ?? [];
  const forwarded = request.headers.get("forwarded");
  if (forwarded === null) return addresses;

  for (const entry of forwarded.split(",")) {
    const field = entry.split(";").find((value) => value.trimStart().toLowerCase().startsWith("for="));
    if (field !== undefined) addresses.push(field.trimStart().slice(4).replace(/^"|"$/g, ""));
  }
  return addresses;
}

function isClearlyNonLoopbackForwardedAddress(value: string): boolean {
  const candidate = value.trim();
  if (candidate === "" || candidate.toLowerCase() === "unknown" || candidate.startsWith("_")) return false;

  const hostname = candidate.startsWith("[")
    ? candidate.slice(1, candidate.indexOf("]"))
    : candidate.includes(":") && isIP(candidate) === 0
      ? candidate.slice(0, candidate.lastIndexOf(":"))
      : candidate;
  return isIP(hostname) !== 0 && !isLocalHostname(hostname);
}

function effectivePort(url: URL): string {
  if (url.port !== "") return url.port;
  if (url.protocol === "http:") return "80";
  if (url.protocol === "https:") return "443";
  return "";
}

function invalid(status: 400 | 403, message: string): LocalProfileRequestResult {
  return { ok: false, status, error: { code: "INVALID_REQUEST", message } };
}

export async function parseLocalProfileRequest(request: Request): Promise<LocalProfileRequestResult> {
  let requestUrl: URL;
  try {
    requestUrl = new URL(request.url);
  } catch {
    return invalid(403, "Dashboard operations are available only from the local application.");
  }
  if (!isLocalHostname(requestUrl.hostname)) {
    return invalid(403, "Dashboard operations are available only from the local application.");
  }
  if (forwardedAddresses(request).some(isClearlyNonLoopbackForwardedAddress)) {
    return invalid(403, "Dashboard operations are available only from the local application.");
  }

  const origin = request.headers.get("origin");
  if (origin !== null) {
    try {
      const originUrl = new URL(origin);
      if (
        !isLocalHostname(originUrl.hostname)
        || originUrl.protocol !== requestUrl.protocol
        || effectivePort(originUrl) !== effectivePort(requestUrl)
      ) {
        return invalid(403, "Cross-origin dashboard operations are not allowed.");
      }
    } catch {
      return invalid(403, "Cross-origin dashboard operations are not allowed.");
    }
  }
  if (request.headers.get("sec-fetch-site") === "cross-site") {
    return invalid(403, "Cross-site dashboard operations are not allowed.");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return invalid(400, "Request body must be valid JSON.");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return invalid(400, "Request body must contain a profile number.");
  }
  const profileNo = (body as Record<string, unknown>).profileNo;
  if (typeof profileNo !== "string" || !PROFILE_NO_PATTERN.test(profileNo)) {
    return invalid(400, "Profile number must use 1-64 letters, numbers, underscores, or hyphens.");
  }

  return { ok: true, profileNo };
}

export function jsonHeaders(): HeadersInit {
  return {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
  };
}
