import type { ProxyPreflightResult, RefreshCheckpointRunRecord } from "@shop-health/domain";

export const REFRESH_ATTEMPT_HEARTBEAT_MS = 30_000;
export const PREFLIGHT_FAILURE_MESSAGE = "Proxy preflight failed before refresh";

export interface RefreshAttemptRepository {
  readonly recordRefreshAttemptStarted: (input: {
    readonly runId: string;
    readonly claimToken: string;
    readonly now: Date;
  }) => Promise<{ readonly id: string }>;
  readonly recordRefreshAttemptProxyPreflight: (input: {
    readonly runId: string;
    readonly attemptId: string;
    readonly claimToken: string;
    readonly preflight: ProxyPreflightResult;
  }) => Promise<boolean>;
  readonly renewRefreshAttemptLease: (input: {
    readonly runId: string;
    readonly attemptId: string;
    readonly claimToken: string;
    readonly now: Date;
  }) => Promise<boolean>;
  readonly releaseRefreshClaim: (input: {
    readonly runId: string;
    readonly claimToken: string;
    readonly now: Date;
  }) => Promise<boolean>;
  readonly completeRefreshAttempt: (input: {
    readonly runId: string;
    readonly attemptId: string;
    readonly claimToken: string;
    readonly outcome: "SUCCESS" | "FAILURE";
    readonly failureMessage?: string;
    readonly now: Date;
  }) => Promise<unknown>;
}

/** Controller failures are already classified; keep their safe reason in the refresh audit. */
export interface RefreshExecutionResult {
  readonly success: boolean;
  readonly failureMessage?: string;
}

export interface ExecuteClaimedRefreshAttemptsInput<TShop extends { readonly id: string }> {
  readonly runs: readonly Pick<RefreshCheckpointRunRecord, "id" | "shopId" | "claimToken">[];
  readonly shops: readonly TShop[];
  readonly now: Date;
  readonly repository: RefreshAttemptRepository;
  readonly preflight: (shop: TShop) => Promise<ProxyPreflightResult>;
  readonly withExecutionLock: (shop: TShop, operation: () => Promise<boolean>) => Promise<boolean | null>;
  readonly execute: (shop: TShop, preflight: ProxyPreflightResult) => Promise<boolean | RefreshExecutionResult>;
}

/**
 * Claim persistence remains DB-owned while W8 injects the authoritative refresh
 * controller. Sequential iteration preserves the no-parallel-profile guarantee.
 */
export async function executeClaimedRefreshAttempts<TShop extends { readonly id: string }>(
  input: ExecuteClaimedRefreshAttemptsInput<TShop>,
): Promise<void> {
  const shopsById = new Map(input.shops.map((shop) => [shop.id, shop]));
  for (const run of input.runs) {
    const shop = shopsById.get(run.shopId);
    const claimToken = run.claimToken;
    if (!shop || claimToken === null) continue;
    const executed = await input.withExecutionLock(shop, async () => {
      const attempt = await input.repository.recordRefreshAttemptStarted({
        runId: run.id,
        claimToken,
        now: input.now,
      });
      const heartbeat = setInterval(() => {
        void input.repository.renewRefreshAttemptLease({
          runId: run.id,
          attemptId: attempt.id,
          claimToken,
          now: new Date(),
        });
      }, REFRESH_ATTEMPT_HEARTBEAT_MS);
      let outcome: "SUCCESS" | "FAILURE" = "FAILURE";
      let failureMessage: string | undefined;
      try {
        let preflight: ProxyPreflightResult | undefined;
        try {
          await input.repository.renewRefreshAttemptLease({
            runId: run.id,
            attemptId: attempt.id,
            claimToken,
            now: new Date(),
          });
          preflight = await input.preflight(shop);
          const recorded = await input.repository.recordRefreshAttemptProxyPreflight({
            runId: run.id,
            attemptId: attempt.id,
            claimToken,
            preflight,
          });
          if (!recorded) throw new Error("Proxy preflight result was not recorded for the owned attempt");
        } catch {
          outcome = "FAILURE";
          failureMessage = PREFLIGHT_FAILURE_MESSAGE;
        }
        if (preflight !== undefined && failureMessage === undefined) {
          if (preflight.status === "UNKNOWN" || preflight.status === "UNAVAILABLE") {
            outcome = "FAILURE";
            failureMessage = `Proxy preflight ${preflight.status}`;
          } else {
            const execution = await input.execute(shop, preflight);
            const result = typeof execution === "boolean" ? { success: execution } : execution;
            outcome = result.success ? "SUCCESS" : "FAILURE";
            if (outcome === "FAILURE") failureMessage = result.failureMessage ?? "Refresh execution returned unsuccessful";
          }
        }
      } catch (error) {
        outcome = "FAILURE";
        failureMessage = error instanceof Error ? error.message : "Unknown refresh execution failure";
      } finally {
        clearInterval(heartbeat);
      }
      try {
        await input.repository.completeRefreshAttempt({
          runId: run.id,
          attemptId: attempt.id,
          claimToken,
          outcome,
          ...(failureMessage === undefined ? {} : { failureMessage }),
          now: new Date(),
        });
      } catch (error) {
        if (outcome === "SUCCESS") throw error;
      }
      return outcome === "SUCCESS";
    });
    if (executed === null) {
      await input.repository.releaseRefreshClaim({ runId: run.id, claimToken, now: new Date() });
    }
  }
}
