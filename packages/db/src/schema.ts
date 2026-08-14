import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid
} from "drizzle-orm/pg-core";

import type {
  BaDecisionReasonCode,
  DecisionFinanceSnapshot,
  DecisionMetricsSnapshot,
  DecisionRiskSnapshot,
  DecisionRuleTrigger
} from "@shop-health/domain";

export const canonicalOrderStatusEnum = pgEnum("canonical_order_status", [
  "PENDING",
  "AWAITING_SHIPMENT",
  "IN_TRANSIT",
  "DELIVERED",
  "COMPLETED",
  "CANCELED",
  "PARTIALLY_REFUNDED",
  "REFUNDED",
  "UNKNOWN"
]);

export const shopSyncStateEnum = pgEnum("shop_sync_state", [
  "ACTIVE",
  "PAUSED_LOGIN",
  "PAUSED_CHALLENGE",
  "PAUSED_LAYOUT",
  "PAUSED_MANUAL",
  "DISABLED"
]);

export const syncModeEnum = pgEnum("sync_mode", [
  "ORDERS",
  "FINANCE",
  "BACKFILL",
  "RECONCILE"
]);

export const syncRunStatusEnum = pgEnum("sync_run_status", [
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
  "ABORTED",
  "PAUSED"
]);

export const recommendationEnum = pgEnum("shop_recommendation", [
  "SCALE",
  "CONTINUE",
  "WATCH",
  "PAUSE"
]);

export const baDecisionEnum = pgEnum("ba_decision", [
  "SCALE",
  "CONTINUE",
  "WATCH",
  "PAUSE"
]);

export const decisionDataCoverageEnum = pgEnum("decision_data_coverage", [
  "COMPLETE",
  "PARTIAL",
  "UNKNOWN"
]);

export const decisionRuleResultEnum = pgEnum("decision_rule_result", [
  "PAUSE",
  "CONTINUE",
  "INSUFFICIENT_DATA"
]);

export const settlementStateEnum = pgEnum("settlement_state", [
  "ON_HOLD",
  "ELIGIBLE",
  "SETTLED",
  "UNKNOWN"
]);

export const evaluationStatusEnum = pgEnum("evaluation_status", [
  "FRESH",
  "STALE",
  "ERROR",
  "INSUFFICIENT_DATA"
]);

export const riskDesiredStateEnum = pgEnum("risk_desired_state", [
  "HOLIDAY_MODE_ON",
  "HOLIDAY_MODE_OFF",
  "INSUFFICIENT_DATA"
]);

export const riskActionStatusEnum = pgEnum("risk_action_status", [
  "PENDING",
  "SUCCEEDED",
  "FAILED",
  "SKIPPED_MANUAL",
  "SKIPPED_IDEMPOTENT"
]);

export const shops = pgTable(
  "shops",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    profileId: text("profile_id").notNull(),
    profileNo: text("profile_no").notNull(),
    displayName: text("display_name"),
    region: text("region").notNull(),
    locale: text("locale").notNull(),
    currency: text("currency").notNull().default("USD"),
    enabled: boolean("enabled").notNull().default(true),
    syncState: shopSyncStateEnum("sync_state").notNull().default("ACTIVE"),
    pauseReason: text("pause_reason"),
    syncRequestedAt: timestamp("sync_requested_at", { withTimezone: true }),
    lastOrdersSyncedAt: timestamp("last_orders_synced_at", { withTimezone: true }),
    lastFinanceSyncedAt: timestamp("last_finance_synced_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex("shops_profile_id_unique").on(table.profileId),
    uniqueIndex("shops_profile_no_unique").on(table.profileNo),
    index("shops_enabled_idx").on(table.enabled),
    check("shops_profile_id_not_blank", sql`length(btrim(${table.profileId})) > 0`),
    check("shops_profile_no_not_blank", sql`length(btrim(${table.profileNo})) > 0`),
    check("shops_currency_format", sql`${table.currency} ~ '^[A-Z]{3}$'`)
  ]
);

export const orders = pgTable(
  "orders",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "restrict", onUpdate: "cascade" }),
    sourceOrderId: text("source_order_id").notNull(),
    sourceStatus: text("source_status").notNull(),
    sourceSubStatus: text("source_sub_status"),
    canonicalStatus: canonicalOrderStatusEnum("canonical_status").notNull(),
    orderCreatedAt: timestamp("order_created_at", { withTimezone: true }),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    sourceUpdatedAt: timestamp("source_updated_at", { withTimezone: true }),
    latestDeliveryAt: timestamp("latest_delivery_at", { withTimezone: true }),
    grandTotal: numeric("grand_total", { precision: 20, scale: 4 }).notNull(),
    currency: text("currency").notNull(),
    trackingNumber: text("tracking_number"),
    carrier: text("carrier"),
    refundAmount: numeric("refund_amount", { precision: 20, scale: 4 }),
    refundStatus: text("refund_status"),
    deliveryEligible: boolean("delivery_eligible"),
    sourceHash: text("source_hash").notNull(),
    sourceSchemaVersion: text("source_schema_version").notNull(),
    rawData: jsonb("raw_data").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex("orders_shop_source_order_unique").on(table.shopId, table.sourceOrderId),
    index("orders_shop_paid_at_idx").on(table.shopId, table.paidAt),
    index("orders_shop_status_idx").on(table.shopId, table.canonicalStatus),
    index("orders_shop_source_updated_idx").on(table.shopId, table.sourceUpdatedAt),
    check("orders_grand_total_nonnegative", sql`${table.grandTotal} >= 0`),
    check("orders_refund_amount_nonnegative", sql`${table.refundAmount} is null or ${table.refundAmount} >= 0`),
    check("orders_currency_format", sql`${table.currency} ~ '^[A-Z]{3}$'`)
  ]
);

export const settlementRecords = pgTable(
  "settlement_records",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "restrict", onUpdate: "cascade" }),
    sourceStatementDetailId: text("source_statement_detail_id").notNull(),
    tradeOrderId: text("trade_order_id"),
    placedAt: timestamp("placed_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    estimatedSettlementAt: timestamp("estimated_settlement_at", { withTimezone: true }),
    earningAmount: numeric("earning_amount", { precision: 20, scale: 4 }),
    feeAmount: numeric("fee_amount", { precision: 20, scale: 4 }),
    shippingAmount: numeric("shipping_amount", { precision: 20, scale: 4 }),
    expectedSettlementAmount: numeric("expected_settlement_amount", { precision: 20, scale: 4 }),
    eligibleSettlementAmount: numeric("eligible_settlement_amount", { precision: 20, scale: 4 }),
    settledAmount: numeric("settled_amount", { precision: 20, scale: 4 }),
    currency: text("currency").notNull(),
    sourceSettlementStatus: text("source_settlement_status").notNull(),
    settlementState: settlementStateEnum("settlement_state").notNull(),
    onHoldReason: text("on_hold_reason"),
    sourceHash: text("source_hash").notNull(),
    sourceSchemaVersion: text("source_schema_version").notNull(),
    rawData: jsonb("raw_data").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex("settlements_shop_source_detail_unique").on(
      table.shopId,
      table.sourceStatementDetailId
    ),
    index("settlements_shop_placed_at_idx").on(table.shopId, table.placedAt),
    index("settlements_shop_trade_order_idx").on(table.shopId, table.tradeOrderId),
    index("settlements_shop_status_idx").on(table.shopId, table.settlementState),
    check("settlements_earning_nonnegative", sql`${table.earningAmount} is null or ${table.earningAmount} >= 0`),
    check("settlements_fee_nonnegative", sql`${table.feeAmount} is null or ${table.feeAmount} >= 0`),
    check("settlements_shipping_nonnegative", sql`${table.shippingAmount} is null or ${table.shippingAmount} >= 0`),
    check("settlements_expected_nonnegative", sql`${table.expectedSettlementAmount} is null or ${table.expectedSettlementAmount} >= 0`),
    check("settlements_eligible_nonnegative", sql`${table.eligibleSettlementAmount} is null or ${table.eligibleSettlementAmount} >= 0`),
    check("settlements_settled_nonnegative", sql`${table.settledAmount} is null or ${table.settledAmount} >= 0`),
    check("settlements_currency_format", sql`${table.currency} ~ '^[A-Z]{3}$'`)
  ]
);

export const financialSnapshots = pgTable(
  "financial_snapshots",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "restrict", onUpdate: "cascade" }),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
    currency: text("currency").notNull(),
    availableBalance: numeric("available_balance", { precision: 20, scale: 4 }),
    frozenBalance: numeric("frozen_balance", { precision: 20, scale: 4 }),
    totalBalance: numeric("total_balance", { precision: 20, scale: 4 }),
    toSettleBalance: numeric("to_settle_balance", { precision: 20, scale: 4 }),
    onHoldBalance: numeric("on_hold_balance", { precision: 20, scale: 4 }),
    reserveRatio: numeric("reserve_ratio", { precision: 10, scale: 6 }),
    reserveDays: integer("reserve_days"),
    reserveLevel: text("reserve_level"),
    snapshotHash: text("snapshot_hash").notNull(),
    sourceSchemaVersion: text("source_schema_version").notNull(),
    rawData: jsonb("raw_data").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex("financial_snapshots_shop_hash_unique").on(table.shopId, table.snapshotHash),
    index("financial_snapshots_shop_captured_idx").on(table.shopId, table.capturedAt),
    check("financial_snapshots_available_nonnegative", sql`${table.availableBalance} is null or ${table.availableBalance} >= 0`),
    check("financial_snapshots_frozen_nonnegative", sql`${table.frozenBalance} is null or ${table.frozenBalance} >= 0`),
    check("financial_snapshots_total_nonnegative", sql`${table.totalBalance} is null or ${table.totalBalance} >= 0`),
    check("financial_snapshots_to_settle_nonnegative", sql`${table.toSettleBalance} is null or ${table.toSettleBalance} >= 0`),
    check("financial_snapshots_on_hold_nonnegative", sql`${table.onHoldBalance} is null or ${table.onHoldBalance} >= 0`),
    check("financial_snapshots_reserve_ratio_range", sql`${table.reserveRatio} is null or (${table.reserveRatio} >= 0 and ${table.reserveRatio} <= 1)`),
    check("financial_snapshots_reserve_days_nonnegative", sql`${table.reserveDays} is null or ${table.reserveDays} >= 0`),
    check("financial_snapshots_currency_format", sql`${table.currency} ~ '^[A-Z]{3}$'`)
  ]
);

export const syncRuns = pgTable(
  "sync_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "restrict", onUpdate: "cascade" }),
    mode: syncModeEnum("mode").notNull(),
    status: syncRunStatusEnum("status").notNull().default("RUNNING"),
    checkpoint: jsonb("checkpoint").$type<Record<string, unknown>>(),
    rowsRead: integer("rows_read").notNull().default(0),
    rowsWritten: integer("rows_written").notNull().default(0),
    retryCount: integer("retry_count").notNull().default(0),
    failureType: text("failure_type"),
    failureMessage: text("failure_message"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    unique("sync_runs_id_shop_unique").on(table.id, table.shopId),
    index("sync_runs_shop_started_idx").on(table.shopId, table.startedAt),
    index("sync_runs_running_idx").on(table.status).where(sql`${table.status} = 'RUNNING'`),
    check("sync_runs_rows_read_nonnegative", sql`${table.rowsRead} >= 0`),
    check("sync_runs_rows_written_nonnegative", sql`${table.rowsWritten} >= 0`),
    check("sync_runs_retry_count_nonnegative", sql`${table.retryCount} >= 0`)
  ]
);

export const kpiSnapshots = pgTable(
  "kpi_snapshots",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "restrict", onUpdate: "cascade" }),
    window: text("window").notNull(),
    periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
    periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
    policyVersion: text("policy_version").notNull(),
    metricsHash: text("metrics_hash").notNull(),
    metrics: jsonb("metrics").$type<Record<string, unknown>>().notNull(),
    trends: jsonb("trends").$type<Record<string, unknown>>().notNull(),
    score: integer("score"),
    confidence: numeric("confidence", { precision: 7, scale: 6 }),
    recommendation: recommendationEnum("recommendation"),
    evaluationStatus: evaluationStatusEnum("evaluation_status").notNull(),
    warnings: jsonb("warnings").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    calculatedAt: timestamp("calculated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex("kpi_snapshots_dedup_unique").on(
      table.shopId,
      table.window,
      table.policyVersion,
      table.metricsHash
    ),
    index("kpi_snapshots_shop_calculated_idx").on(table.shopId, table.calculatedAt),
    check("kpi_snapshots_period_valid", sql`${table.periodStart} < ${table.periodEnd}`),
    check("kpi_snapshots_score_range", sql`${table.score} is null or (${table.score} >= 0 and ${table.score} <= 100)`),
    check("kpi_snapshots_confidence_range", sql`${table.confidence} is null or (${table.confidence} >= 0 and ${table.confidence} <= 1)`)
  ]
);

export const riskControlStates = pgTable(
  "risk_control_states",
  {
    shopId: uuid("shop_id")
      .primaryKey()
      .references(() => shops.id, { onDelete: "restrict", onUpdate: "cascade" }),
    desiredState: riskDesiredStateEnum("desired_state").notNull(),
    observedHolidayModeEnabled: boolean("observed_holiday_mode_enabled"),
    lastObservedAt: timestamp("last_observed_at", { withTimezone: true }),
    automationOwned: boolean("automation_owned").notNull().default(false),
    consecutiveSafeCycles: integer("consecutive_safe_cycles").notNull().default(0),
    decision: jsonb("decision").$type<Record<string, unknown>>().notNull(),
    policyVersion: text("policy_version").notNull(),
    lastEvaluatedAt: timestamp("last_evaluated_at", { withTimezone: true }).notNull(),
    lastActionAt: timestamp("last_action_at", { withTimezone: true }),
    lastActionStatus: riskActionStatusEnum("last_action_status"),
    lastActionError: text("last_action_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    check("risk_control_states_safe_cycles_nonnegative", sql`${table.consecutiveSafeCycles} >= 0`),
    check("risk_control_states_policy_version_not_blank", sql`length(btrim(${table.policyVersion})) > 0`),
    check(
      "risk_control_states_action_error_requires_status",
      sql`${table.lastActionError} is null or ${table.lastActionStatus} is not null`
    ),
    check(
      "risk_control_states_action_error_matches_status",
      sql`
        (${table.lastActionStatus} = 'FAILED' and ${table.lastActionError} is not null)
        or (${table.lastActionStatus} is distinct from 'FAILED' and ${table.lastActionError} is null)
      `
    ),
    check(
      "risk_control_states_automation_ownership_requires_enabled_observation",
      sql`not ${table.automationOwned} or ${table.observedHolidayModeEnabled} is true`
    )
  ]
);

export const decisionCases = pgTable(
  "decision_cases",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "restrict", onUpdate: "cascade" }),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    metricsSnapshot: jsonb("metrics_snapshot").$type<DecisionMetricsSnapshot>().notNull(),
    riskSnapshot: jsonb("risk_snapshot").$type<DecisionRiskSnapshot>().notNull(),
    financeSnapshot: jsonb("finance_snapshot").$type<DecisionFinanceSnapshot>().notNull(),
    ruleDecision: decisionRuleResultEnum("rule_decision").notNull(),
    ruleTriggers: jsonb("rule_triggers").$type<DecisionRuleTrigger[]>().notNull().default(sql`'[]'::jsonb`),
    dataCoverage: decisionDataCoverageEnum("data_coverage").notNull(),
    sourceSyncRunId: uuid("source_sync_run_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index("decision_cases_shop_observed_idx").on(table.shopId, table.observedAt),
    index("decision_cases_source_sync_run_idx").on(table.sourceSyncRunId),
    foreignKey({
      columns: [table.sourceSyncRunId, table.shopId],
      foreignColumns: [syncRuns.id, syncRuns.shopId],
      name: "decision_cases_source_sync_run_shop_fk"
    })
      .onDelete("restrict")
      .onUpdate("cascade"),
    check(
      "decision_cases_metrics_snapshot_object",
      sql`jsonb_typeof(${table.metricsSnapshot}) = 'object'`
    ),
    check(
      "decision_cases_risk_snapshot_object",
      sql`jsonb_typeof(${table.riskSnapshot}) = 'object'`
    ),
    check(
      "decision_cases_finance_snapshot_object",
      sql`jsonb_typeof(${table.financeSnapshot}) = 'object'`
    ),
    check(
      "decision_cases_rule_triggers_array",
      sql`jsonb_typeof(${table.ruleTriggers}) = 'array'`
    )
  ]
);

export const baDecisions = pgTable(
  "ba_decisions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    decisionCaseId: uuid("decision_case_id")
      .notNull()
      .references(() => decisionCases.id, { onDelete: "restrict", onUpdate: "cascade" }),
    decision: baDecisionEnum("decision").notNull(),
    confidence: numeric("confidence", { precision: 7, scale: 6 }),
    reasonCodes: jsonb("reason_codes").$type<BaDecisionReasonCode[]>().notNull(),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index("ba_decisions_case_created_idx").on(table.decisionCaseId, table.createdAt),
    check(
      "ba_decisions_confidence_range",
      sql`${table.confidence} is null or (${table.confidence} >= 0 and ${table.confidence} <= 1)`
    ),
    check("ba_decisions_reason_codes_array", sql`jsonb_typeof(${table.reasonCodes}) = 'array'`),
    check("ba_decisions_note_not_blank", sql`${table.note} is null or length(btrim(${table.note})) > 0`)
  ]
);

export type ShopRow = typeof shops.$inferSelect;
export type OrderRow = typeof orders.$inferSelect;
export type SettlementRecordRow = typeof settlementRecords.$inferSelect;
export type FinancialSnapshotRow = typeof financialSnapshots.$inferSelect;
export type SyncRunRow = typeof syncRuns.$inferSelect;
export type KpiSnapshotRow = typeof kpiSnapshots.$inferSelect;
export type RiskControlStateRow = typeof riskControlStates.$inferSelect;
export type DecisionCaseRow = typeof decisionCases.$inferSelect;
export type BaDecisionRow = typeof baDecisions.$inferSelect;
