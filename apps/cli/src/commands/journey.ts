import {
  findShopByProfileNo,
  getCurrentAiTaskConfig,
  getEffectiveRiskPolicy,
  getFinanceSummary,
} from "@shop-health/db";
import {
  resolveAiTaskConfig,
  testAiTaskConnection,
} from "@shop-health/decision-ai";
import {
  BaDecisionInputSchema,
  BaDecisionReasonCodeSchema,
  BaDecisionSchema,
  BaPlannedMethodSchema,
} from "@shop-health/domain";
import { runAuthoritativeFinanceRefresh, runShopSync } from "@shop-health/sync";
import { createSellerCenterDataSource } from "@shop-health/seller-center";
import { createAdsPowerProxyPreflight } from "@shop-health/seller-center/proxy-preflight";
import { Command, InvalidArgumentError } from "commander";

import { withDatabase } from "../db-runtime.js";
import { CliError } from "../errors.js";
import { calculateAndStoreReport } from "../metrics-service.js";
import { parseComparisonPeriod } from "../period.js";
import { createCliDecisionWorkflow } from "../review-workflow.js";
import { printJson, printKeyValues } from "../presentation/output.js";
import type { CliRuntime } from "../runtime.js";

export interface JourneyInput {
  readonly profileNo: string;
  readonly period: string;
  readonly effectiveAt: Date;
  readonly decision: "SCALE" | "CONTINUE" | "SLOW_SELL" | "WATCH" | "PAUSE";
  readonly reasonCodes: readonly string[];
  readonly plannedMethods: readonly string[];
  readonly notes?: string;
  readonly requestId?: string;
}

export interface JourneyResult {
  readonly schemaVersion: "v1-journey.v1";
  readonly profileNo: string;
  readonly stages: Record<string, unknown>;
}

export type JourneyRunner = (input: JourneyInput) => Promise<JourneyResult>;

function parseDate(value: string): Date {
  const date = new Date(value);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(date.getTime())) {
    throw new InvalidArgumentError("effective-at must be an ISO timestamp with an explicit UTC or offset");
  }
  return date;
}

function parseEnum<T>(schema: { safeParse: (value: unknown) => { success: boolean; data?: T } }, value: string, label: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new InvalidArgumentError(`Invalid ${label}: ${value}`);
  return parsed.data as T;
}

function createSource(runtime: CliRuntime) {
  const options = {
    baseUrl: runtime.config.ADSPOWER_BASE_URL,
    logger: runtime.logger,
    ...(runtime.config.ADSPOWER_AUTOFILL_REFERENCE === undefined ? {} : { credentialReference: runtime.config.ADSPOWER_AUTOFILL_REFERENCE }),
  };
  return createSellerCenterDataSource(runtime.config.ADSPOWER_API_KEY === undefined
    ? options
    : { ...options, apiKey: runtime.config.ADSPOWER_API_KEY });
}

function safeFinanceHealth(summary: Awaited<ReturnType<typeof getFinanceSummary>>): Record<string, unknown> {
  return {
    proofStatus: summary.proofStatus,
    statementCount: summary.statementCount,
    onHoldCount: summary.onHoldCount,
    expectedSettlementAmount: summary.expectedSettlementAmount,
    onHoldExpectedAmount: summary.onHoldExpectedAmount,
    settledAmount: summary.settledAmount,
    unknownOnHoldReasonCount: summary.unknownOnHoldReasonCount,
    missingOnHoldExpectedAmountCount: summary.missingOnHoldExpectedAmountCount,
    latestSnapshot: summary.latestSnapshot === null ? null : {
      capturedAt: summary.latestSnapshot.capturedAt.toISOString(),
      currency: summary.latestSnapshot.currency,
      officialOnHoldAmount: summary.latestSnapshot.officialOnHoldAmount,
    },
  };
}

export function createDefaultJourneyRunner(runtime: CliRuntime): JourneyRunner {
  return async (input) => {
    const period = parseComparisonPeriod(input.period);
    const stages = await withDatabase(runtime, async (context) => {
      const { db } = context;
      const shop = await findShopByProfileNo(db, input.profileNo);
      if (shop === null) throw new CliError({ failureType: "SHOP_NOT_FOUND", message: `Shop profile ${input.profileNo} is not configured` });
      const source = createSource(runtime);
      const orders = await runShopSync({ context, source, shop, kind: "orders", mode: "INCREMENTAL", logger: runtime.logger });
      const preflight = createAdsPowerProxyPreflight(runtime.config.ADSPOWER_API_KEY === undefined
        ? { baseUrl: runtime.config.ADSPOWER_BASE_URL }
        : { baseUrl: runtime.config.ADSPOWER_BASE_URL, apiKey: runtime.config.ADSPOWER_API_KEY });
      const finance = await runAuthoritativeFinanceRefresh({
        context,
        source,
        shop,
        preflight: await preflight.preflight({ profileId: shop.profileId }),
        logger: runtime.logger,
      });
      if (finance.status !== "SUCCEEDED") {
        throw new CliError({
          failureType: finance.status,
          message: `Authoritative Finance refresh requires attention: ${finance.reason}`,
        });
      }
      const financeSummary = await getFinanceSummary(db, shop.id);
      const report = await calculateAndStoreReport(db, shop, period, input.effectiveAt);
      const policy = await getEffectiveRiskPolicy(db, { shopId: shop.id, effectiveAt: input.effectiveAt });
      const currentAi = await getCurrentAiTaskConfig(db, { taskId: "SHOP_HEALTH_REVIEWER", effectiveAt: input.effectiveAt });
      const aiConfig = resolveAiTaskConfig("SHOP_HEALTH_REVIEWER", currentAi, process.env);
      const aiConnection = await testAiTaskConnection(aiConfig, { environment: process.env });
      return {
        select: { profileNo: shop.profileNo, profileId: shop.profileId, tiktokShopId: shop.tiktokShopId },
        sync: { orders, finance },
        financeHealth: safeFinanceHealth(financeSummary),
        metrics: { period, report: report.metrics },
        policy,
        aiConnection,
        shop,
      } satisfies Record<string, unknown>;
    });

    // Freeze policy and AI resolution at the journey's declared instant before the Case is created.
    const workflow = createCliDecisionWorkflow(runtime, { now: () => input.effectiveAt });
    const started = await workflow.startReview({ profileNo: input.profileNo, ...(input.requestId === undefined ? {} : { requestId: input.requestId }) });
    const baInput = BaDecisionInputSchema.parse({
      decision: input.decision,
      reasonCode: input.reasonCodes[0],
      reasonCodes: [...input.reasonCodes],
      ...(input.plannedMethods.length === 0 ? {} : { plannedMethods: [...input.plannedMethods] }),
      ...(input.notes === undefined ? {} : { notes: input.notes }),
    });
    const decided = await workflow.decide({
      caseId: started.case.id,
      decision: baInput.decision,
      reasonCode: baInput.reasonCode,
      reasonCodes: baInput.reasonCodes ?? [baInput.reasonCode],
      ...(baInput.plannedMethods === undefined ? {} : { plannedMethods: baInput.plannedMethods }),
      ...(baInput.notes === undefined ? {} : { notes: baInput.notes }),
      ...(input.requestId === undefined ? {} : { requestId: input.requestId }),
    });
    const readback = await workflow.show(started.case.id);
    const history = await workflow.history({ profileNo: input.profileNo, limit: 20 });
    const { shop: _shop, ...preReviewStages } = stages;
    return {
      schemaVersion: "v1-journey.v1",
      profileNo: input.profileNo,
      stages: {
        ...preReviewStages,
        // The Case is the immutable authority for the Official-On-Hold Rule.
        rule: started.rule,
        case: { caseId: started.case.id, immutable: true, review: started },
        ba: decided,
        readback: { immutable: true, review: readback },
        history,
      },
    };
  };
}

export function registerJourneyCommands(program: Command, runner: JourneyRunner): void {
  program.command("journey <profileNo>")
    .description("Run the complete CLI-first V1 proof journey")
    .requiredOption("--period <period>", "Analytical period such as 30d")
    .requiredOption("--effective-at <timestamp>", "Policy/AI effective instant")
    .requiredOption("--decision <decision>", "BA decision", (value) => parseEnum(BaDecisionSchema, value, "BA decision"))
    .requiredOption("--reason-code <code>", "Repeatable BA reason code", (value, previous: string[]) => [...previous, parseEnum(BaDecisionReasonCodeSchema, value, "BA reason code")], [])
    .option("--planned-method <method>", "Repeatable SLOW_SELL method", (value, previous: string[]) => [...previous, parseEnum(BaPlannedMethodSchema, value, "SLOW_SELL planned method")], [])
    .option("--notes <text>", "BA notes")
    .option("--request-id <uuid>", "Idempotency request UUID")
    .option("--json", "Print stable JSON output")
    .action(async (profileNo: string, options: {
      period: string; effectiveAt: string; decision: JourneyInput["decision"]; reasonCode: string[];
      plannedMethod: string[]; notes?: string; requestId?: string; json?: boolean;
    }) => {
      if (options.reasonCode.length === 0) throw new InvalidArgumentError("at least one --reason-code is required");
      const result = await runner({
        profileNo,
        period: options.period,
        effectiveAt: parseDate(options.effectiveAt),
        decision: options.decision,
        reasonCodes: options.reasonCode,
        plannedMethods: options.plannedMethod,
        ...(options.notes === undefined ? {} : { notes: options.notes }),
        ...(options.requestId === undefined ? {} : { requestId: options.requestId }),
      });
      if (options.json) printJson(result);
      else printKeyValues([["Profile", profileNo], ["Journey", "COMPLETE"], ["Case", String((result.stages.case as { caseId: string }).caseId)], ["BA decision", options.decision], ["History", "AVAILABLE"]]);
    });
}
