import { z } from "zod";

export const ProxyPreflightInputSchema = z.strictObject({
  profileId: z.string().trim().min(1),
});

export const ProxyPreflightStatusSchema = z.enum([
  "HEALTHY",
  "DEGRADED",
  "UNAVAILABLE",
  "UNKNOWN",
]);

export const ProxyPreflightReasonClassSchema = z.enum([
  "OBSERVED_HEALTHY",
  "OBSERVED_SLOW",
  "OBSERVED_UNAVAILABLE",
  "OBSERVATION_UNAVAILABLE",
  "AUTH_REJECTED",
  "HTTP_REJECTED",
  "REQUEST_TIMEOUT",
  "NETWORK_UNAVAILABLE",
]);

// ponytail: the Local API has no safe IPv6 observation contract; add a dedicated
// public IPv6 parser only when a documented server-side endpoint supplies it.
const PublicIpv4Schema = z.string().regex(/^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/)
  .refine((value) => {
    const [first, second, third, fourth] = value.split(".").map(Number);
    const address = ((first ?? 0) * 256 ** 3) + ((second ?? 0) * 256 ** 2) + ((third ?? 0) * 256) + (fourth ?? 0);
    const inRange = (start: number, end: number) => address >= start && address <= end;
    return !inRange(0x00000000, 0x00ffffff)
      && !inRange(0x0a000000, 0x0affffff)
      && !inRange(0x64400000, 0x647fffff)
      && !inRange(0x7f000000, 0x7fffffff)
      && !inRange(0xa9fe0000, 0xa9feffff)
      && !inRange(0xac100000, 0xac1fffff)
      && !inRange(0xc0000000, 0xc00000ff)
      && !inRange(0xc0000200, 0xc00002ff)
      && !inRange(0xc01fc400, 0xc01fc4ff)
      && !inRange(0xc0336400, 0xc03364ff)
      && !inRange(0xc034c100, 0xc034c1ff)
      && !inRange(0xc05b0000, 0xc05b00ff)
      && !inRange(0xc0586300, 0xc05863ff)
      && !inRange(0xc0702400, 0xc07024ff)
      && !inRange(0xc0a80000, 0xc0a8ffff)
      && !inRange(0xc0af3000, 0xc0af30ff)
      && !inRange(0xc6120000, 0xc613ffff)
      && !inRange(0xc6336400, 0xc63364ff)
      && !inRange(0xcb007100, 0xcb0071ff)
      && !inRange(0xe0000000, 0xffffffff);
  }, "exitIp must be a public IPv4 address");

export const ProxyPreflightResultSchema = z.strictObject({
  status: ProxyPreflightStatusSchema,
  latencyMs: z.number().int().min(0).max(10_000),
  exitIp: PublicIpv4Schema.nullable(),
  reasonClass: ProxyPreflightReasonClassSchema,
}).superRefine((result, context) => {
  if ((result.status === "UNAVAILABLE" || result.status === "UNKNOWN") && result.exitIp !== null) {
    context.addIssue({ code: "custom", path: ["exitIp"], message: "unavailable and unknown results cannot retain an exit IP" });
  }
  const allowedReasons = result.status === "HEALTHY"
    ? ["OBSERVED_HEALTHY"]
    : result.status === "DEGRADED"
      ? ["OBSERVED_SLOW"]
      : result.status === "UNAVAILABLE"
        ? ["OBSERVED_UNAVAILABLE", "AUTH_REJECTED", "HTTP_REJECTED", "REQUEST_TIMEOUT", "NETWORK_UNAVAILABLE"]
        : ["OBSERVATION_UNAVAILABLE"];
  if (!allowedReasons.includes(result.reasonClass)) {
    context.addIssue({ code: "custom", path: ["reasonClass"], message: "reason class is inconsistent with observed status" });
  }
});

export type ProxyPreflightInput = z.input<typeof ProxyPreflightInputSchema>;
export type ProxyPreflightResult = z.output<typeof ProxyPreflightResultSchema>;

export interface ProxyPreflight {
  preflight(input: ProxyPreflightInput): Promise<ProxyPreflightResult>;
}
