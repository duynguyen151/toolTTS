import { z } from "zod";

import {
  SourceCapabilitySchema,
  SourceProviderSchema,
  type SourceCapability,
  type SourceProvider,
} from "./contracts/source.js";

export const FinanceHealthSchema = z.enum([
  "FRESH",
  "STALE",
  "UNKNOWN",
  "INCOMPLETE",
  "RECONCILIATION_FAILED",
]);
export const FinanceCompletenessSchema = z.enum(["COMPLETE", "INCOMPLETE", "UNKNOWN"]);
export const FinanceReconciliationSchema = z.enum(["RECONCILED", "FAILED", "UNKNOWN"]);
export const OfficialOnHoldAvailabilitySchema = z.enum(["AVAILABLE", "UNAVAILABLE"]);
export const FinanceRefreshStateSchema = z.enum([
  "NOT_REQUESTED",
  "RUNNING",
  "FAILED",
  "ABORTED",
  "PAUSED",
  "SUCCEEDED",
]);

export const FinanceHealthSnapshotSchema = z.strictObject({
  schemaVersion: z.literal("finance-health.v1"),
  provider: SourceProviderSchema.nullable(),
  capability: SourceCapabilitySchema.nullable(),
  capabilityProofRevision: z.string().trim().min(1).nullable(),
  providerUpdatedAt: z.string().datetime().nullable(),
  collectedAt: z.string().datetime().nullable(),
  evaluatedAt: z.string().datetime(),
  ageMs: z.number().int().nonnegative().nullable(),
  health: FinanceHealthSchema,
  completeness: FinanceCompletenessSchema,
  reconciliation: FinanceReconciliationSchema,
  officialOnHoldAvailability: OfficialOnHoldAvailabilitySchema,
  refreshState: FinanceRefreshStateSchema,
});

export interface FinanceCapabilityProof {
  readonly provider: SourceProvider;
  readonly capability: SourceCapability;
  readonly proofRevision: string;
}

export interface FinanceHealthResolverInput {
  readonly capabilityProof: FinanceCapabilityProof | null;
  readonly providerUpdatedAt: Date | null;
  readonly collectedAt: Date | null;
  readonly evaluatedAt: Date;
  readonly freshnessWindowMs: number;
  readonly proofStatus: "PROVEN" | "PROOF_UNAVAILABLE";
  readonly sourceComplete: boolean | null;
  readonly reconciled: boolean | null;
  readonly refreshState: z.infer<typeof FinanceRefreshStateSchema>;
}

export type FinanceHealthSnapshot = z.infer<typeof FinanceHealthSnapshotSchema>;

export const SELLER_CENTER_OFFICIAL_ON_HOLD_PROOF = {
  provider: "SELLER_CENTER",
  capability: "OFFICIAL_ON_HOLD",
  proofRevision: "seller-center-official-on-hold.v1",
} as const satisfies FinanceCapabilityProof;

export function resolveFinanceHealth(input: FinanceHealthResolverInput): FinanceHealthSnapshot {
  const capabilityProof = parseCapabilityProof(input.capabilityProof);
  const officialOnHoldCapable = capabilityProof?.capability === "OFFICIAL_ON_HOLD";
  const rawAgeMs = input.collectedAt === null
    ? null
    : input.evaluatedAt.getTime() - input.collectedAt.getTime();
  const ageMs = rawAgeMs !== null && rawAgeMs >= 0 ? rawAgeMs : null;
  const freshness = ageMs === null
    ? "UNKNOWN"
    : ageMs > input.freshnessWindowMs
      ? "STALE"
      : "FRESH";
  const completeness = input.sourceComplete === true
    ? "COMPLETE"
    : input.sourceComplete === false
      ? "INCOMPLETE"
      : "UNKNOWN";
  const reconciliation = input.reconciled === true
    ? "RECONCILED"
    : input.reconciled === false
      ? "FAILED"
      : "UNKNOWN";

  const officialOnHoldAvailability = officialOnHoldCapable &&
      input.proofStatus === "PROVEN" &&
      completeness === "COMPLETE" &&
      reconciliation === "RECONCILED" &&
      freshness !== "UNKNOWN"
    ? "AVAILABLE"
    : "UNAVAILABLE";
  const health = !officialOnHoldCapable
    ? "UNKNOWN"
    : completeness === "INCOMPLETE"
      ? "INCOMPLETE"
      : completeness === "UNKNOWN"
        ? "UNKNOWN"
        : reconciliation === "FAILED"
          ? "RECONCILIATION_FAILED"
          : reconciliation === "UNKNOWN" || input.proofStatus !== "PROVEN"
            ? "UNKNOWN"
            : freshness;

  return FinanceHealthSnapshotSchema.parse({
    schemaVersion: "finance-health.v1",
    provider: capabilityProof?.provider ?? null,
    capability: capabilityProof?.capability ?? null,
    capabilityProofRevision: capabilityProof?.proofRevision ?? null,
    providerUpdatedAt: input.providerUpdatedAt?.toISOString() ?? null,
    collectedAt: input.collectedAt?.toISOString() ?? null,
    evaluatedAt: input.evaluatedAt.toISOString(),
    ageMs,
    health,
    completeness,
    reconciliation,
    officialOnHoldAvailability,
    refreshState: input.refreshState,
  });
}

function parseCapabilityProof(proof: FinanceCapabilityProof | null): FinanceCapabilityProof | null {
  if (proof === null) return null;
  const provider = SourceProviderSchema.parse(proof.provider);
  const capability = SourceCapabilitySchema.parse(proof.capability);
  return {
    provider,
    capability,
    proofRevision: z.string().trim().min(1).parse(proof.proofRevision),
  };
}
