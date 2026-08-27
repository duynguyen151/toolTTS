import type { ProxyPreflightResult, RefreshCheckpointRunRecord } from "@shop-health/domain";

export const REFRESH_ATTEMPT_HEARTBEAT_MS = 30_000;

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

export interface ExecuteClaimedRefreshAttemptsInput<TShop extends { readonly id: string }> {
  readonly runs: readonly Pick<RefreshCheckpointRunRecord, "id" | "shopId" | "claimToken">[];
  readonly shops: readonly TShop[];
  readonly now: Date;
  readonly repository: RefreshAttemptRepository;
  readonly preflight: (shop: TShop) => Promise<ProxyPreflightResult>;
  readonly withExecutionLock: (shop: TShop, operation: () => Promise<boolean>) => Promise<boolean | null>;
  readonly execute: (shop: TShop) => Promise<boolean>;
}

/**
 * Thin W6 boundary: claim persistence is DB-owned; browser/source execution stays
 * with the existing worker path until W8 composes the full refresh controller.
 * Sequential iteration preserves the existing no-parallel-profile guarantee.
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
      let outcome: "SUCCESS" | "FAILURE";
      let failureMessage: string | undefined;
      try {
        await input.repository.renewRefreshAttemptLease({
          runId: run.id,
          attemptId: attempt.id,
          claimToken,
          now: new Date(),
        });
        const preflight = await input.preflight(shop);
        const recorded = await input.repository.recordRefreshAttemptProxyPreflight({
          runId: run.id,
          attemptId: attempt.id,
          claimToken,
          preflight,
        });
        if (!recorded) throw new Error("Proxy preflight result was not recorded for the owned attempt");
        if (preflight.status === "UNKNOWN" || preflight.status === "UNAVAILABLE") {
          outcome = "FAILURE";
          failureMessage = `Proxy preflight ${preflight.status}`;
        } else {
          outcome = (await input.execute(shop)) ? "SUCCESS" : "FAILURE";
          if (outcome === "FAILURE") failureMessage = "Refresh execution returned unsuccessful";
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
