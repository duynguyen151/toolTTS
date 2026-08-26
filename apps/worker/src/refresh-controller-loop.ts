import type { RefreshCheckpointRunRecord } from "@shop-health/domain";

export interface RefreshAttemptRepository {
  readonly recordRefreshAttemptStarted: (input: {
    readonly runId: string;
    readonly claimToken: string;
    readonly now: Date;
  }) => Promise<{ readonly id: string }>;
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
    if (!shop || run.claimToken === null) continue;
    const attempt = await input.repository.recordRefreshAttemptStarted({
      runId: run.id,
      claimToken: run.claimToken,
      now: input.now,
    });
    let outcome: "SUCCESS" | "FAILURE";
    let failureMessage: string | undefined;
    try {
      outcome = (await input.execute(shop)) ? "SUCCESS" : "FAILURE";
      if (outcome === "FAILURE") failureMessage = "Refresh execution returned unsuccessful";
    } catch (error) {
      outcome = "FAILURE";
      failureMessage = error instanceof Error ? error.message : "Unknown refresh execution failure";
    }
    try {
      await input.repository.completeRefreshAttempt({
        runId: run.id,
        attemptId: attempt.id,
        claimToken: run.claimToken,
        outcome,
        ...(failureMessage === undefined ? {} : { failureMessage }),
        now: new Date(),
      });
    } catch (error) {
      if (outcome === "SUCCESS") throw error;
    }
  }
}
