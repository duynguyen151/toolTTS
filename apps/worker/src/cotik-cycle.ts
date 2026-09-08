import type { DatabaseContext } from "@shop-health/db";
import {
  createOrGetPostIntent,
  ensureCotikWorkflowSettings,
  findCotikAccountById,
  getCotikTrackingRunById,
  getDecryptedCotikToken,
  listAttemptsForIntent,
  listInProgressPostIntents,
  listPendingPostIntents,
  recordPostAttempt,
  resetCotikWorkflowSettingsForDeployment,
  withCotikCycleExecutionLock
} from "@shop-health/db";
import {
  checkOrderTrackingReady,
  createMultiAccountCotikClient,
  confirmOrderTrackingReadback,
  postCotikTrackingBatch,
  type CotikTrackingItem
} from "@shop-health/cotik";
import {
  runCotikDiscoverySync,
  runCotikMultiAccountOrdersSync,
  resolveCotikTrackingInput,
  type CotikMultiAccountDiscoveryResult,
  type CotikMultiAccountOrdersSyncResult
} from "@shop-health/sync";
import type { Logger } from "pino";

export interface CotikCycleOptions {
  readonly context: DatabaseContext;
  readonly deploymentId?: string | undefined;
  readonly vaultKeyHex?: string | undefined;
  readonly baseUrl?: string | undefined;
  readonly logger?: Logger | undefined;
  readonly now?: (() => Date) | undefined;
  readonly forceDiscovery?: boolean | undefined;
  readonly forceOrderSync?: boolean | undefined;
  readonly skipDiscovery?: boolean | undefined;
  readonly skipOrderSync?: boolean | undefined;
  readonly trackingRunId?: string | undefined;
  readonly trackingIntentIds?: readonly string[] | undefined;
}

export interface CotikCycleResult {
  readonly status: "COMPLETED" | "LOCKED" | "SKIPPED";
  readonly deploymentReset: boolean;
  readonly syncEnabled: boolean;
  readonly postEnabled: boolean;
  readonly discoveryResult?: CotikMultiAccountDiscoveryResult | undefined;
  readonly ordersSyncResult?: CotikMultiAccountOrdersSyncResult | undefined;
  readonly trackingBatchesExecuted?: number | undefined;
  readonly trackingOrdersConfirmed?: number | undefined;
  readonly message?: string | undefined;
}

let lastDiscoveryRunMs = 0;
let lastOrderSyncRunMs = 0;

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const ONE_HOUR_MS = 60 * 60 * 1000;

export async function runCotikWorkerCycle(
  options: CotikCycleOptions
): Promise<CotikCycleResult> {
  const { context, deploymentId, logger } = options;
  const now = options.now ? options.now() : new Date();
  const nowMs = now.getTime();

  return (
    (await withCotikCycleExecutionLock(context, async () => {
      // 1. Deployment Reset: dual kill switch resets to OFF on new deployment
      const resetResult = deploymentId?.trim()
        ? await resetCotikWorkflowSettingsForDeployment(context.db, deploymentId)
        : { reset: false, previousDeploymentId: null, currentDeploymentId: null };

      if (resetResult.reset) {
        logger?.warn(
          {
            previousDeploymentId: resetResult.previousDeploymentId,
            currentDeploymentId: resetResult.currentDeploymentId
          },
          "New deployment detected. Cotik kill switch and sync switch reset to OFF."
        );
      }

      // 2. Read workflow settings
      const settings = await ensureCotikWorkflowSettings(context.db);
      const { cotikSyncEnabled, cotikPostEnabled } = settings;

      // 3. Discovery: runs on start, daily, or when forced
      let discoveryResult: CotikMultiAccountDiscoveryResult | undefined;
      const isDiscoveryDue =
        options.skipDiscovery !== true &&
        (options.forceDiscovery === true ||
        lastDiscoveryRunMs === 0 ||
        nowMs - lastDiscoveryRunMs >= ONE_DAY_MS);

      if (isDiscoveryDue) {
        logger?.info("Starting Cotik multi-account discovery cycle");
        discoveryResult = await runCotikDiscoverySync({
          context,
          vaultKeyHex: options.vaultKeyHex,
          baseUrl: options.baseUrl,
          logger,
          now: options.now
        });
        lastDiscoveryRunMs = nowMs;
      }

      // 4. Order sync: runs every 60m if cotikSyncEnabled is ON
      let ordersSyncResult: CotikMultiAccountOrdersSyncResult | undefined;
      const isOrderSyncDue =
        options.skipOrderSync !== true &&
        cotikSyncEnabled &&
        (options.forceOrderSync === true ||
          lastOrderSyncRunMs === 0 ||
          nowMs - lastOrderSyncRunMs >= ONE_HOUR_MS);

      if (isOrderSyncDue) {
        logger?.info("Starting Cotik multi-account order sync cycle");
        ordersSyncResult = await runCotikMultiAccountOrdersSync({
          context,
          vaultKeyHex: options.vaultKeyHex,
          baseUrl: options.baseUrl,
          mode: "incremental",
          logger,
          now: options.now
        });
        lastOrderSyncRunMs = nowMs;
      }

      // 5. Tracking POST cycle: ONLY executes when cotikPostEnabled is TRUE
      let trackingBatchesExecuted = 0;
      let trackingOrdersConfirmed = 0;
      const killSwitchMessage = !cotikSyncEnabled || !cotikPostEnabled
        ? "Cotik POST skipped: enable both kill switches before manual POST."
        : undefined;

      if (cotikSyncEnabled && cotikPostEnabled) {
        if (options.trackingRunId) {
          const trackingRun = await getCotikTrackingRunById(context.db, options.trackingRunId);
          if (trackingRun?.mode !== "REPLAY") {
            return {
              status: "COMPLETED",
              deploymentReset: resetResult.reset,
              syncEnabled: cotikSyncEnabled,
              postEnabled: cotikPostEnabled,
              discoveryResult,
              ordersSyncResult,
              trackingBatchesExecuted,
              trackingOrdersConfirmed,
              message: "Cotik tracking run is not an authorized replay run"
            };
          }
        }
        const inProgressIntents = await listInProgressPostIntents(context.db, 50, {
          ...(options.trackingRunId ? { runId: options.trackingRunId } : {})
        });
        for (const intent of inProgressIntents) {
          if (options.trackingRunId && intent.region !== "US") continue;
          const account = await findCotikAccountById(context.db, intent.accountId);
          if (account?.status !== "ACTIVE" || account.lastSeenAt === null) continue;
          const token = await getDecryptedCotikToken(context.db, intent.accountId, options.vaultKeyHex);
          if (!token) continue;
          const client = createMultiAccountCotikClient({
            accountId: intent.accountId,
            token,
            baseUrl: options.baseUrl
          });
          const confirmed = await confirmOrderTrackingReadback(client, intent.orderId, intent.tracking);
          if (!confirmed) continue;
          await recordPostAttempt(context.db, {
            intentId: intent.id,
            attemptNo: intent.attemptCount,
            requestPayload: {
              orderId: intent.orderId,
              tracking: intent.tracking,
              providerId: intent.providerId
            },
            outcome: "SUCCESS",
            readbackConfirmed: true
          });
          trackingOrdersConfirmed++;
        }
        const pendingIntents = await listPendingPostIntents(context.db, 50, {
          reserve: false,
          ...(options.trackingRunId ? { runId: options.trackingRunId } : {}),
          ...(options.trackingIntentIds ? { intentIds: [...options.trackingIntentIds] } : {})
        });

        if (pendingIntents.length > 0) {
          logger?.info(
            { count: pendingIntents.length },
            "Processing pending Cotik tracking intents"
          );

          const resolvedIntents: Array<{
            intent: (typeof pendingIntents)[number];
            resolution: Extract<Awaited<ReturnType<typeof resolveCotikTrackingInput>>, { status: "RESOLVED" }>;
          }> = [];
          for (const intent of pendingIntents) {
            const intentRegion = intent.region === "US" || intent.region === "UK" ? intent.region : undefined;
            if (!intentRegion) {
              logger?.warn({ intentId: intent.id, region: intent.region }, "Cotik tracking intent has unknown region");
              continue;
            }
            if (options.trackingRunId && intentRegion !== "US") {
              logger?.warn({ intentId: intent.id, region: intent.region }, "Cotik replay intent is outside the US boundary");
              continue;
            }
            const resolution = await resolveCotikTrackingInput(context.db, {
              logicalShopId: intent.logicalShopId,
              orderId: intent.orderId,
              tracking: intent.tracking,
              provider: intent.providerId,
              region: intentRegion
            });
            if (resolution.status === "RESOLVED") {
              if (resolution.input.providerId !== intent.providerId) continue;
              if (resolution.input.accountId !== intent.accountId) {
                if (intent.attemptCount !== 0) continue;
                const rerouted = await createOrGetPostIntent(context.db, {
                  ...resolution.input,
                  runId: intent.runId
                });
                if (rerouted.accountId !== resolution.input.accountId || rerouted.status !== "PENDING" || rerouted.attemptCount !== 0) continue;
                resolvedIntents.push({ intent: rerouted, resolution });
              } else {
                resolvedIntents.push({ intent, resolution });
              }
            } else {
              logger?.warn({ intentId: intent.id, reason: resolution.reason }, "Cotik tracking intent paused");
            }
          }

          const intentsByAccount = new Map<string, typeof resolvedIntents>();
          for (const resolved of resolvedIntents) {
            const key = resolved.resolution.input.accountId;
            const list = intentsByAccount.get(key) ?? [];
            list.push(resolved);
            intentsByAccount.set(key, list);
          }

          for (const [, accountIntents] of intentsByAccount.entries()) {
            const accountId = accountIntents[0]?.resolution.input.accountId;
            if (!accountId) continue;
            try {
              const token = await getDecryptedCotikToken(
                context.db,
                accountId,
                options.vaultKeyHex
              );

              if (!token) {
                logger?.warn({ accountId }, "Missing vault token for Cotik account");
                continue;
              }

              const client = createMultiAccountCotikClient({
                accountId,
                token,
                baseUrl: options.baseUrl,
                beforePost: async () => {
                  const latestSettings = await ensureCotikWorkflowSettings(context.db);
                  if (!latestSettings.cotikSyncEnabled || !latestSettings.cotikPostEnabled) {
                    throw new Error("COTIK_DISPATCH_DISABLED");
                  }
                  for (const entry of postIntents) {
                    const latest = await resolveCotikTrackingInput(context.db, entry.input);
                    if (latest.status !== "RESOLVED" || latest.input.accountId !== entry.input.accountId || latest.input.providerId !== entry.input.providerId) {
                      throw new Error("COTIK_DISPATCH_EVIDENCE_CHANGED");
                    }
                  }
                }
              });

              const region = accountIntents[0]?.resolution.input.region;
              if (!region) continue;
              const retryableIntents: typeof accountIntents = [];
              for (const entry of accountIntents) {
                const attempts = await listAttemptsForIntent(context.db, entry.intent.id);
                const previousAttempt = attempts.at(-1);
                if (previousAttempt?.outcome === "TIMEOUT" || previousAttempt?.outcome === "UNCONFIRMED") {
                  const confirmed = await confirmOrderTrackingReadback(
                    client,
                    entry.intent.orderId,
                    entry.intent.tracking
                  );
                  if (confirmed) {
                    await recordPostAttempt(context.db, {
                      intentId: entry.intent.id,
                      attemptNo: entry.intent.attemptCount,
                      requestPayload: {
                        orderId: entry.intent.orderId,
                        tracking: entry.intent.tracking,
                        providerId: entry.intent.providerId
                      },
                      outcome: "SUCCESS",
                      readbackConfirmed: true
                    });
                    trackingOrdersConfirmed++;
                    continue;
                  }
                  await recordPostAttempt(context.db, {
                    intentId: entry.intent.id, attemptNo: entry.intent.attemptCount,
                    requestPayload: { orderId: entry.intent.orderId, tracking: entry.intent.tracking, providerId: entry.intent.providerId },
                    outcome: "UNCONFIRMED", keepInProgress: true
                  });
                  continue;
                }
                if (!await checkOrderTrackingReady(client, entry.intent.orderId, entry.intent.tracking)) continue;
                retryableIntents.push(entry);
              }
              if (retryableIntents.length === 0) continue;
              const reservedIntents = await listPendingPostIntents(context.db, Math.min(accountIntents.length, 50), {
                reserve: true,
                ...(options.trackingRunId ? { runId: options.trackingRunId } : {}),
                intentIds: retryableIntents.map(({ intent }) => intent.id),
                requestPayloadByIntent: Object.fromEntries(
                  retryableIntents.map(({ intent, resolution }) => [intent.id, {
                    orderId: resolution.input.orderId,
                    tracking: resolution.input.tracking,
                    providerId: resolution.input.providerId
                  }])
                )
              });
              const resolvedById = new Map(retryableIntents.map((entry) => [entry.intent.id, entry.resolution.input]));
              const postIntents: Array<{
                intent: (typeof pendingIntents)[number];
                input: Extract<Awaited<ReturnType<typeof resolveCotikTrackingInput>>, { status: "RESOLVED" }>['input'];
              }> = [];

              for (const intent of reservedIntents) {
                const initialInput = resolvedById.get(intent.id);
                if (!initialInput) continue;
                const intentRegion = intent.region === "US" || intent.region === "UK" ? intent.region : undefined;
                if (!intentRegion) continue;
                const currentResolution = await resolveCotikTrackingInput(context.db, {
                  logicalShopId: intent.logicalShopId,
                  orderId: intent.orderId,
                  tracking: intent.tracking,
                  provider: intent.providerId,
                  region: intentRegion
                });
                if (
                  currentResolution.status !== "RESOLVED" ||
                  currentResolution.input.accountId !== initialInput.accountId ||
                  currentResolution.input.providerId !== initialInput.providerId ||
                  currentResolution.input.logicalShopId !== initialInput.logicalShopId ||
                  currentResolution.input.region !== initialInput.region ||
                  currentResolution.input.orderId !== initialInput.orderId ||
                  currentResolution.input.tracking !== initialInput.tracking
                ) {
                  logger?.warn({ intentId: intent.id }, "Cotik tracking intent changed after reservation; pausing dispatch");
                  await recordPostAttempt(context.db, {
                    intentId: intent.id,
                    attemptNo: intent.attemptCount,
                    requestPayload: {
                      orderId: intent.orderId,
                      tracking: intent.tracking,
                      providerId: intent.providerId
                    },
                    outcome: "UNCONFIRMED",
                    readbackConfirmed: false,
                    abort: true
                  });
                  continue;
                }

                postIntents.push({ intent, input: currentResolution.input });
              }

              if (postIntents.length === 0) continue;

              const dispatchSettings = await ensureCotikWorkflowSettings(context.db);
              if (!dispatchSettings.cotikSyncEnabled || !dispatchSettings.cotikPostEnabled) {
                logger?.warn("Cotik tracking dispatch paused because a kill switch is OFF");
                for (const { intent, input } of postIntents) {
                  await recordPostAttempt(context.db, {
                    intentId: intent.id,
                    attemptNo: intent.attemptCount,
                    requestPayload: {
                      orderId: input.orderId,
                      tracking: input.tracking,
                      providerId: input.providerId
                    },
                    outcome: "UNCONFIRMED",
                    readbackConfirmed: false,
                    abort: true
                  });
                }
                continue;
              }

              const trackingItems: CotikTrackingItem[] = postIntents.map(({ input }) => ({
                orderId: input.orderId,
                tracking: input.tracking,
                providerId: input.providerId
              }));

              let postResult;
              try {
                postResult = await postCotikTrackingBatch({
                  client,
                  items: trackingItems,
                  isPostAuthorized: async () => {
                    try {
                      const latestSettings = await ensureCotikWorkflowSettings(context.db);
                      return latestSettings.cotikSyncEnabled && latestSettings.cotikPostEnabled;
                    } catch {
                      return false;
                    }
                  }
                });
              } catch (error) {
                for (const { intent, input } of postIntents) {
                  await recordPostAttempt(context.db, {
                    intentId: intent.id,
                    attemptNo: intent.attemptCount,
                    requestPayload: {
                      orderId: input.orderId,
                      tracking: input.tracking,
                      providerId: input.providerId
                    },
                    responsePayload: null,
                    outcome: "TIMEOUT",
                    readbackConfirmed: false,
                    keepInProgress: true
                  });
                }
                logger?.error({ accountId, failureType: "POST_TRANSPORT_ERROR" }, "Cotik tracking POST threw");
                continue;
              }

              trackingBatchesExecuted++;
              trackingOrdersConfirmed += postResult.confirmedOrders.length;

                // Record attempt for each intent
                const confirmedSet = new Set(postResult.confirmedOrders);
              for (const { intent, input } of postIntents) {
                  const isConfirmed = confirmedSet.has(input.orderId);
                  const isFailed = postResult.failedOrders.some(
                    (f: { orderId: string }) => f.orderId === input.orderId
                  );

                  await recordPostAttempt(context.db, {
                    intentId: intent.id,
                    attemptNo: intent.attemptCount,
                    requestPayload: {
                      orderId: input.orderId,
                      tracking: input.tracking,
                      providerId: input.providerId
                    },
                    responsePayload: {
                      readbackConfirmed: isConfirmed
                    },
                    outcome: isConfirmed
                      ? "SUCCESS"
                      : isFailed
                        ? "HTTP_ERROR"
                        : "UNCONFIRMED",
                    readbackConfirmed: isConfirmed,
                    ...(!isConfirmed && (postResult.unconfirmedOrders.includes(input.orderId) || !isFailed) ? { keepInProgress: true } : {})
                  });
              }
            } catch (accountPostError) {
              logger?.error(
                {
                  accountId,
                  failureType: "TRACKING_BATCH_PAUSED"
                },
                "Failed to process tracking batch for account"
              );
            }
          }
        }
      }

      return {
        status: "COMPLETED" as const,
        deploymentReset: resetResult.reset,
        syncEnabled: cotikSyncEnabled,
        postEnabled: cotikPostEnabled,
        ...(discoveryResult !== undefined ? { discoveryResult } : {}),
        ...(ordersSyncResult !== undefined ? { ordersSyncResult } : {}),
        trackingBatchesExecuted,
        trackingOrdersConfirmed,
        ...(killSwitchMessage === undefined ? {} : { message: killSwitchMessage })
      };
    })) ?? {
      status: "LOCKED",
      deploymentReset: false,
      syncEnabled: false,
      postEnabled: false,
      message: "Cotik worker cycle skipped: lock busy"
    }
  );
}
