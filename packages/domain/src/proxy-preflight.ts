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
    const octets = value.split(".").map(Number);
    const [first, second, third] = octets;
    return first !== undefined
      && second !== undefined
      && third !== undefined
      && first !== 0
      && first !== 10
      && first !== 127
      && first < 224
      && !(first === 100 && second >= 64 && second <= 127)
      && !(first === 169 && second === 254)
      && !(first === 172 && second >= 16 && second <= 31)
      && !(first === 192 && (second === 0 || second === 168 || (second === 88 && third === 99)))
      && !(first === 198 && (second === 18 || second === 19 || second === 51))
      && !(first === 203 && second === 0);
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
