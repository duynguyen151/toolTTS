import { sql } from "drizzle-orm";
import {
  bigint,
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
  AiFailureCode,
  AiDecisionContext,
  BaDecisionReasonCode,
  BaPlannedMethod,
  DecisionCoverageSnapshot,
  DecisionFinanceSnapshot,
  DecisionMetricsSnapshot,
  DecisionRiskSnapshot,
  DecisionRuleTrigger,
  GlobalRiskPolicyRevision,
  ResolvedRiskPolicySnapshot,
  ShopRiskPolicyOverrideRevision,
  SourceCoverageProof,
  SourceProvenance
} from "@shop-health/domain";

export const canonicalOrderStatusEnum = pgEnum("canonical_order_status", [
  "PENDING",
  "UNPAID",
  "ON_HOLD",
  "AWAITING_SHIPMENT",
  "AWAITING_COLLECTION",
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

export const shopVerificationStatusEnum = pgEnum("shop_verification_status", [
  "NOT_VERIFIED",
  "VERIFIED",
  "FAILED",
]);

export const shopEligibilityStatusEnum = pgEnum("shop_eligibility_status", [
  "ELIGIBLE",
  "INELIGIBLE",
  "UNSUPPORTED_REGION",
]);

export const adspowerProfileVerificationStateEnum = pgEnum("adspower_profile_verification_state", [
  "UNVERIFIED",
  "LOGIN_REQUIRED",
  "HUMAN_ACTION_REQUIRED",
  "NOT_TIKTOK_SELLER",
  "UNSUPPORTED_REGION",
  "SHOP_SELECTION_REQUIRED",
  "SHOP_IDENTITY_CHANGED",
  "READY",
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
  "PAUSE",
  "SLOW_SELL"
]);

export const decisionDataOriginEnum = pgEnum("decision_data_origin", [
  "LIVE",
  "DEMO_SANITIZED"
]);

export const aiDecisionStatusEnum = pgEnum("ai_decision_status", [
  "AVAILABLE",
  "UNAVAILABLE"
]);

export const decisionExecutionActionEnum = pgEnum("decision_execution_action", [
  "HOLIDAY_MODE_ON"
]);

export const decisionExecutionModeEnum = pgEnum("decision_execution_mode", [
  "DRY_RUN"
]);

export const decisionExecutionStatusEnum = pgEnum("decision_execution_status", [
  "SIMULATED"
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
    tiktokShopId: text("tiktok_shop_id"),
    displayName: text("display_name"),
    region: text("region").notNull(),
    locale: text("locale").notNull(),
    verificationStatus: shopVerificationStatusEnum("verification_status")
      .notNull()
      .default("NOT_VERIFIED"),
    eligibilityStatus: shopEligibilityStatusEnum("eligibility_status")
      .notNull()
      .default("ELIGIBLE"),
    currency: text("currency").notNull().default("USD"),
    dataOrigin: decisionDataOriginEnum("data_origin").notNull().default("LIVE"),
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
    uniqueIndex("shops_tiktok_shop_id_unique").on(table.tiktokShopId),
    unique("shops_id_data_origin_unique").on(table.id, table.dataOrigin),
    index("shops_enabled_idx").on(table.enabled),
    check("shops_profile_id_not_blank", sql`length(btrim(${table.profileId})) > 0`),
    check("shops_profile_no_not_blank", sql`length(btrim(${table.profileNo})) > 0`),
    check(
      "shops_tiktok_shop_id_not_blank",
      sql`${table.tiktokShopId} is null or length(btrim(${table.tiktokShopId})) > 0`
    ),
    check(
      "shops_region_eligibility_consistent",
      sql`(${table.region} = 'US' and ${table.locale} = 'en-US') or ${table.eligibilityStatus} = 'UNSUPPORTED_REGION'`
    ),
    check("shops_currency_format", sql`${table.currency} ~ '^[A-Z]{3}$'`),
    check(
      "shops_demo_disabled",
      sql`${table.dataOrigin} <> 'DEMO_SANITIZED' or (not ${table.enabled} and ${table.syncState} = 'DISABLED')`
    )
  ]
);

export const adspowerProfiles = pgTable(
  "adspower_profiles",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    profileId: text("profile_id").notNull(),
    profileNo: text("profile_no").notNull(),
    verificationState: adspowerProfileVerificationStateEnum("verification_state")
      .notNull()
      .default("UNVERIFIED"),
    eligibilityStatus: shopEligibilityStatusEnum("eligibility_status")
      .notNull()
      .default("INELIGIBLE"),
    lastVerifiedAt: timestamp("last_verified_at", { withTimezone: true }),
    verifiedTiktokShopId: text("verified_tiktok_shop_id"),
    verifiedShopDisplayName: text("verified_shop_display_name"),
    activeShopId: uuid("active_shop_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("adspower_profiles_profile_id_unique").on(table.profileId),
    uniqueIndex("adspower_profiles_profile_no_unique").on(table.profileNo),
    uniqueIndex("adspower_profiles_active_shop_id_unique").on(table.activeShopId),
    foreignKey({
      columns: [table.activeShopId],
      foreignColumns: [shops.id],
      name: "adspower_profiles_active_shop_id_shops_id_fk",
    }).onDelete("restrict").onUpdate("cascade"),
    check("adspower_profiles_profile_id_not_blank", sql`length(btrim(${table.profileId})) > 0`),
    check("adspower_profiles_profile_no_not_blank", sql`length(btrim(${table.profileNo})) > 0`),
    check(
      "adspower_profiles_verified_tiktok_shop_id_not_blank",
      sql`${table.verifiedTiktokShopId} is null or length(btrim(${table.verifiedTiktokShopId})) > 0`,
    ),
    check(
      "adspower_profiles_active_shop_requires_proven_identity",
      sql`${table.activeShopId} is null or (
        ${table.verificationState} = 'READY'
        and ${table.eligibilityStatus} = 'ELIGIBLE'
        and ${table.verifiedTiktokShopId} is not null
      )`,
    ),
  ],
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
    readyToShipAt: timestamp("ready_to_ship_at", { withTimezone: true }),
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
    officialOnHoldAmount: numeric("official_on_hold_amount", { precision: 20, scale: 4 }),
    settlementPeriodDays: integer("settlement_period_days"),
    settlementPeriodType: text("settlement_period_type"),
    reserveRatio: numeric("reserve_ratio", { precision: 10, scale: 6 }),
    reserveDays: integer("reserve_days"),
    reserveLevel: text("reserve_level"),
    snapshotHash: text("snapshot_hash").notNull(),
    sourceSchemaVersion: text("source_schema_version").notNull(),
    rawData: jsonb("raw_data").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    unique("financial_snapshots_id_shop_unique").on(table.id, table.shopId),
    uniqueIndex("financial_snapshots_shop_capture_hash_unique").on(
      table.shopId,
      table.capturedAt,
      table.snapshotHash,
    ),
    index("financial_snapshots_shop_hash_idx").on(table.shopId, table.snapshotHash),
    index("financial_snapshots_shop_captured_idx").on(table.shopId, table.capturedAt),
    check("financial_snapshots_available_nonnegative", sql`${table.availableBalance} is null or ${table.availableBalance} >= 0`),
    check("financial_snapshots_frozen_nonnegative", sql`${table.frozenBalance} is null or ${table.frozenBalance} >= 0`),
    check("financial_snapshots_total_nonnegative", sql`${table.totalBalance} is null or ${table.totalBalance} >= 0`),
    check("financial_snapshots_to_settle_nonnegative", sql`${table.toSettleBalance} is null or ${table.toSettleBalance} >= 0`),
    check("financial_snapshots_on_hold_nonnegative", sql`${table.onHoldBalance} is null or ${table.onHoldBalance} >= 0`),
    check("financial_snapshots_official_on_hold_nonnegative", sql`${table.officialOnHoldAmount} is null or ${table.officialOnHoldAmount} >= 0`),
    check("financial_snapshots_captured_at_finite", sql`${table.capturedAt} not in ('infinity'::timestamptz, '-infinity'::timestamptz)`),
    check("financial_snapshots_snapshot_hash_sha256", sql`${table.snapshotHash} ~ '^[0-9a-f]{64}$'`),
    check("financial_snapshots_source_schema_version_not_blank", sql`length(btrim(${table.sourceSchemaVersion})) > 0`),
    check("financial_snapshots_period_days_nonnegative", sql`${table.settlementPeriodDays} is null or ${table.settlementPeriodDays} >= 0`),
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
    sourceCoverage: jsonb("source_coverage").$type<SourceCoverageProof>(),
    sourceComplete: boolean("source_complete"),
    sourceReconciled: boolean("source_reconciled"),
    sourceCapturedAt: timestamp("source_captured_at", { withTimezone: true }),
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
    check("sync_runs_retry_count_nonnegative", sql`${table.retryCount} >= 0`),
    check(
      "sync_runs_source_coverage_object",
      sql`${table.sourceCoverage} is null or jsonb_typeof(${table.sourceCoverage}) = 'object'`
    )
  ]
);

export const financeCaptures = pgTable(
  "finance_captures",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    shopId: uuid("shop_id").notNull(),
    syncRunId: uuid("sync_run_id").notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
    snapshotId: uuid("snapshot_id").notNull(),
    snapshotHash: text("snapshot_hash").notNull(),
    populationHash: text("population_hash").notNull(),
    currency: text("currency").notNull(),
    officialOnHoldAmount: numeric("official_on_hold_amount", { precision: 20, scale: 4 }).notNull(),
    itemCount: integer("item_count").notNull(),
    sourceSchemaVersion: text("source_schema_version").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("finance_captures_id_shop_unique").on(table.id, table.shopId),
    uniqueIndex("finance_captures_shop_captured_unique").on(table.shopId, table.capturedAt),
    uniqueIndex("finance_captures_sync_run_unique").on(table.syncRunId),
    foreignKey({
      columns: [table.syncRunId, table.shopId],
      foreignColumns: [syncRuns.id, syncRuns.shopId],
      name: "finance_captures_sync_run_shop_fk",
    }).onDelete("restrict").onUpdate("cascade"),
    foreignKey({
      columns: [table.snapshotId, table.shopId],
      foreignColumns: [financialSnapshots.id, financialSnapshots.shopId],
      name: "finance_captures_snapshot_shop_fk",
    }).onDelete("restrict").onUpdate("cascade"),
    check("finance_captures_snapshot_hash_sha256", sql`${table.snapshotHash} ~ '^[0-9a-f]{64}$'`),
    check("finance_captures_population_hash_sha256", sql`${table.populationHash} ~ '^[0-9a-f]{64}$'`),
    check("finance_captures_currency_format", sql`${table.currency} ~ '^[A-Z]{3}$'`),
    check("finance_captures_official_on_hold_nonnegative", sql`${table.officialOnHoldAmount} >= 0`),
    check("finance_captures_captured_at_finite", sql`${table.capturedAt} not in ('infinity'::timestamptz, '-infinity'::timestamptz)`),
    check("finance_captures_item_count_nonnegative", sql`${table.itemCount} >= 0`),
    check("finance_captures_source_schema_version_not_blank", sql`length(btrim(${table.sourceSchemaVersion})) > 0`),
  ],
);

export const financeCaptureItems = pgTable(
  "finance_capture_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    captureId: uuid("capture_id").notNull(),
    shopId: uuid("shop_id").notNull(),
    sourceStatementDetailId: text("source_statement_detail_id").notNull(),
    sourceStatementId: text("source_statement_id"),
    sourceStatementVersion: text("source_statement_version"),
    expectedSettlementAmount: numeric("expected_settlement_amount", { precision: 20, scale: 4 }),
    settledAmount: numeric("settled_amount", { precision: 20, scale: 4 }),
    currency: text("currency").notNull(),
    sourceSettlementStatus: text("source_settlement_status").notNull(),
    settlementState: settlementStateEnum("settlement_state").notNull(),
    onHoldReason: text("on_hold_reason"),
    sourceHash: text("source_hash").notNull(),
    sourceSchemaVersion: text("source_schema_version").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("finance_capture_items_capture_source_unique").on(
      table.captureId,
      table.sourceStatementDetailId,
    ),
    index("finance_capture_items_shop_capture_idx").on(table.shopId, table.captureId),
    index("finance_capture_items_capture_state_reason_idx").on(
      table.captureId,
      table.settlementState,
      table.onHoldReason,
    ),
    foreignKey({
      columns: [table.captureId, table.shopId],
      foreignColumns: [financeCaptures.id, financeCaptures.shopId],
      name: "finance_capture_items_capture_shop_fk",
    }).onDelete("restrict").onUpdate("cascade"),
    check("finance_capture_items_currency_format", sql`${table.currency} ~ '^[A-Z]{3}$'`),
    check("finance_capture_items_source_id_not_blank", sql`length(btrim(${table.sourceStatementDetailId})) > 0`),
    check("finance_capture_items_statement_identity_complete", sql`${table.sourceStatementId} is not null and length(btrim(${table.sourceStatementId})) > 0 and ${table.sourceStatementVersion} is not null and length(btrim(${table.sourceStatementVersion})) > 0`),
    check("finance_capture_items_settled_nonnegative", sql`${table.settledAmount} is null or ${table.settledAmount} >= 0`),
    check("finance_capture_items_source_status_not_blank", sql`length(btrim(${table.sourceSettlementStatus})) > 0`),
    check("finance_capture_items_source_hash_sha256", sql`${table.sourceHash} ~ '^[0-9a-f]{64}$'`),
    check("finance_capture_items_source_schema_version_not_blank", sql`length(btrim(${table.sourceSchemaVersion})) > 0`),
  ],
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

export const riskPolicyScopeEnum = pgEnum("risk_policy_scope", ["GLOBAL", "SHOP"]);

export const riskPolicyRevisions = pgTable(
  "risk_policy_revisions",
  {
    revisionId: uuid("revision_id").defaultRandom().primaryKey(),
    sequence: bigint("sequence", { mode: "bigint" }).generatedAlwaysAsIdentity(),
    scope: riskPolicyScopeEnum("scope").notNull(),
    shopId: uuid("shop_id").references(() => shops.id, {
      onDelete: "restrict",
      onUpdate: "cascade",
    }),
    enabled: boolean("enabled").notNull().default(true),
    payload: jsonb("payload").$type<
      | Omit<GlobalRiskPolicyRevision, "revisionId" | "effectiveFrom">
      | Omit<ShopRiskPolicyOverrideRevision, "revisionId" | "shopId" | "effectiveFrom">
    >().notNull(),
    effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("risk_policy_revisions_sequence_unique").on(table.sequence),
    index("risk_policy_revisions_global_effective_idx")
      .on(table.effectiveFrom, table.sequence)
      .where(sql`${table.scope} = 'GLOBAL'`),
    index("risk_policy_revisions_shop_effective_idx")
      .on(table.shopId, table.effectiveFrom, table.sequence)
      .where(sql`${table.scope} = 'SHOP'`),
    check(
      "risk_policy_revisions_scope_shop_consistent",
      sql`(${table.scope} = 'GLOBAL' and ${table.shopId} is null and ${table.enabled})
        or (${table.scope} = 'SHOP' and ${table.shopId} is not null)`,
    ),
    check(
      "risk_policy_revisions_effective_from_finite",
      sql`${table.effectiveFrom} not in ('infinity'::timestamptz, '-infinity'::timestamptz)`,
    ),
    check(
      "risk_policy_revisions_payload_valid",
      sql`
        case
          when ${table.scope} = 'GLOBAL' then
            jsonb_typeof(${table.payload}) = 'object'
            and ${table.payload} ?& array['version', 'currency', 'thresholds', 'caution']
            and (${table.payload} - array['version', 'currency', 'thresholds', 'caution']) = '{}'::jsonb
            and jsonb_typeof(${table.payload}->'version') = 'string'
            and length(btrim(${table.payload}->>'version')) > 0
            and jsonb_typeof(${table.payload}->'currency') = 'string'
            and (${table.payload}->>'currency') ~ '^[A-Z]{3}$'
            and jsonb_typeof(${table.payload}->'thresholds') = 'object'
            and (${table.payload}->'thresholds') ?& array[
              'stopOnHoldValueAt', 'stopDeliveryRateBelow', 'minimumOrdersForRateRule',
              'resumeOnHoldValueBelow', 'resumeDeliveryRateAt', 'stableCyclesBeforeResume'
            ]
            and ((${table.payload}->'thresholds') - array[
              'stopOnHoldValueAt', 'stopDeliveryRateBelow', 'minimumOrdersForRateRule',
              'resumeOnHoldValueBelow', 'resumeDeliveryRateAt', 'stableCyclesBeforeResume'
            ]) = '{}'::jsonb
            and jsonb_typeof(${table.payload}->'caution') = 'object'
            and (${table.payload}->'caution') ?& array['onHoldValue', 'deliveryRate']
            and ((${table.payload}->'caution') - array['onHoldValue', 'deliveryRate']) = '{}'::jsonb
          when ${table.scope} = 'SHOP' and not ${table.enabled} then
            ${table.payload} = '{"thresholds": {}, "caution": {}}'::jsonb
          when ${table.scope} = 'SHOP' then
            jsonb_typeof(${table.payload}) = 'object'
            and ${table.payload} ?& array['thresholds', 'caution']
            and (${table.payload} - array['thresholds', 'caution']) = '{}'::jsonb
            and jsonb_typeof(${table.payload}->'thresholds') = 'object'
            and ((${table.payload}->'thresholds') - array[
              'stopOnHoldValueAt', 'stopDeliveryRateBelow', 'minimumOrdersForRateRule',
              'resumeOnHoldValueBelow', 'resumeDeliveryRateAt', 'stableCyclesBeforeResume'
            ]) = '{}'::jsonb
            and jsonb_typeof(${table.payload}->'caution') = 'object'
            and ((${table.payload}->'caution') - array['onHoldValue', 'deliveryRate']) = '{}'::jsonb
          else false
        end
        and case when (${table.payload}->'thresholds') ? 'stopOnHoldValueAt' then
          jsonb_typeof(${table.payload}->'thresholds'->'stopOnHoldValueAt') = 'string'
          and (${table.payload}->'thresholds'->>'stopOnHoldValueAt') ~ '^[0-9]+([.][0-9]+)?$'
        else true end
        and case when (${table.payload}->'thresholds') ? 'resumeOnHoldValueBelow' then
          jsonb_typeof(${table.payload}->'thresholds'->'resumeOnHoldValueBelow') = 'string'
          and (${table.payload}->'thresholds'->>'resumeOnHoldValueBelow') ~ '^[0-9]+([.][0-9]+)?$'
        else true end
        and case when (${table.payload}->'thresholds') ? 'stopDeliveryRateBelow' then
          jsonb_typeof(${table.payload}->'thresholds'->'stopDeliveryRateBelow') = 'number'
          and (${table.payload}->'thresholds'->>'stopDeliveryRateBelow')::numeric between 0 and 1
        else true end
        and case when (${table.payload}->'thresholds') ? 'resumeDeliveryRateAt' then
          jsonb_typeof(${table.payload}->'thresholds'->'resumeDeliveryRateAt') = 'number'
          and (${table.payload}->'thresholds'->>'resumeDeliveryRateAt')::numeric between 0 and 1
        else true end
        and case when (${table.payload}->'thresholds') ? 'minimumOrdersForRateRule' then
          jsonb_typeof(${table.payload}->'thresholds'->'minimumOrdersForRateRule') = 'number'
          and (${table.payload}->'thresholds'->>'minimumOrdersForRateRule')::numeric >= 0
          and mod((${table.payload}->'thresholds'->>'minimumOrdersForRateRule')::numeric, 1) = 0
          and (${table.payload}->'thresholds'->>'minimumOrdersForRateRule')::numeric <= 9007199254740991
        else true end
        and case when (${table.payload}->'thresholds') ? 'stableCyclesBeforeResume' then
          jsonb_typeof(${table.payload}->'thresholds'->'stableCyclesBeforeResume') = 'number'
          and (${table.payload}->'thresholds'->>'stableCyclesBeforeResume')::numeric > 0
          and mod((${table.payload}->'thresholds'->>'stableCyclesBeforeResume')::numeric, 1) = 0
          and (${table.payload}->'thresholds'->>'stableCyclesBeforeResume')::numeric <= 9007199254740991
        else true end
        and case when (${table.payload}->'caution') ? 'onHoldValue' then
          jsonb_typeof(${table.payload}->'caution'->'onHoldValue') = 'object'
          and case ${table.payload}->'caution'->'onHoldValue'->>'mode'
            when 'DISABLED' then ${table.payload}->'caution'->'onHoldValue' = '{"mode": "DISABLED"}'::jsonb
            when 'ABSOLUTE_BUFFER' then
              ${table.payload}->'caution'->'onHoldValue' ?& array['mode', 'buffer']
              and jsonb_typeof(${table.payload}->'caution'->'onHoldValue'->'buffer') = 'string'
              and (${table.payload}->'caution'->'onHoldValue'->>'buffer') ~ '^[0-9]+([.][0-9]+)?$'
              and ((${table.payload}->'caution'->'onHoldValue') - array['mode', 'buffer']) = '{}'::jsonb
            when 'RELATIVE_RATIO' then
              ${table.payload}->'caution'->'onHoldValue' ?& array['mode', 'ratio']
              and jsonb_typeof(${table.payload}->'caution'->'onHoldValue'->'ratio') = 'number'
              and (${table.payload}->'caution'->'onHoldValue'->>'ratio')::numeric > 0
              and (${table.payload}->'caution'->'onHoldValue'->>'ratio')::numeric <= 1
              and ((${table.payload}->'caution'->'onHoldValue') - array['mode', 'ratio']) = '{}'::jsonb
            else false
          end
        else true end
        and case when (${table.payload}->'caution') ? 'deliveryRate' then
          jsonb_typeof(${table.payload}->'caution'->'deliveryRate') = 'object'
          and case ${table.payload}->'caution'->'deliveryRate'->>'mode'
            when 'DISABLED' then ${table.payload}->'caution'->'deliveryRate' = '{"mode": "DISABLED"}'::jsonb
            when 'ABSOLUTE_BUFFER' then
              ${table.payload}->'caution'->'deliveryRate' ?& array['mode', 'buffer']
              and jsonb_typeof(${table.payload}->'caution'->'deliveryRate'->'buffer') = 'string'
              and (${table.payload}->'caution'->'deliveryRate'->>'buffer') ~ '^[0-9]+([.][0-9]+)?$'
              and ((${table.payload}->'caution'->'deliveryRate') - array['mode', 'buffer']) = '{}'::jsonb
            when 'RELATIVE_RATIO' then
              ${table.payload}->'caution'->'deliveryRate' ?& array['mode', 'ratio']
              and jsonb_typeof(${table.payload}->'caution'->'deliveryRate'->'ratio') = 'number'
              and (${table.payload}->'caution'->'deliveryRate'->>'ratio')::numeric > 0
              and (${table.payload}->'caution'->'deliveryRate'->>'ratio')::numeric <= 1
              and ((${table.payload}->'caution'->'deliveryRate') - array['mode', 'ratio']) = '{}'::jsonb
            else false
          end
        else true end
        and case when ${table.scope} = 'GLOBAL' then
          (${table.payload}->'thresholds'->>'resumeDeliveryRateAt')::numeric >=
            (${table.payload}->'thresholds'->>'stopDeliveryRateBelow')::numeric
          and (${table.payload}->'thresholds'->>'resumeOnHoldValueBelow')::numeric <=
            (${table.payload}->'thresholds'->>'stopOnHoldValueAt')::numeric
        else true end
      `,
    ),
  ],
);

export const aiTaskConfigs = pgTable(
  "ai_task_configs",
  {
    revisionId: uuid("revision_id").defaultRandom().primaryKey(),
    sequence: bigint("sequence", { mode: "bigint" }).generatedAlwaysAsIdentity(),
    taskId: text("task_id").notNull(),
    provider: text("provider").notNull(),
    baseUrl: text("base_url").notNull(),
    model: text("model").notNull(),
    parameters: jsonb("parameters").$type<{ readonly timeoutMs?: number | undefined }>().notNull().default(sql`'{}'::jsonb`),
    secretRef: text("secret_ref").notNull(),
    enabled: boolean("enabled").notNull(),
    status: text("status").notNull(),
    effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("ai_task_configs_sequence_unique").on(table.sequence),
    index("ai_task_configs_current_effective_idx").on(table.taskId, table.effectiveFrom, table.sequence),
    check("ai_task_configs_task_id_not_blank", sql`length(btrim(${table.taskId})) > 0`),
    check("ai_task_configs_task_id_valid", sql`${table.taskId} in ('SHOP_HEALTH_REVIEWER', 'FINANCE_SPECIALIST', 'ORDER_ANOMALY_REVIEWER', 'BA_ASSISTANT')`),
    check("ai_task_configs_provider_not_blank", sql`length(btrim(${table.provider})) > 0`),
    check("ai_task_configs_provider_valid", sql`${table.provider} in ('9router', 'openai-compatible', 'huggingface-hosted')`),
    check("ai_task_configs_model_not_blank", sql`length(btrim(${table.model})) > 0`),
    check("ai_task_configs_model_valid", sql`(${table.provider} <> '9router' or ${table.model} in ('oc/deepseek-v4-flash-free', 'oc/big-pickle', 'oc/hy3-free', 'oc/laguna-s-2.1-free', 'oc/nemotron-3-ultra-free', 'oc/nemotron-3.5-lightning-free'))`),
    check("ai_task_configs_base_url_valid", sql`${table.baseUrl} ~ '^https?://([A-Za-z0-9.-]+|\\[[0-9A-Fa-f:.]+\\])(:([0-9]{1,4}|[1-5][0-9]{4}|6[0-4][0-9]{3}|65[0-4][0-9]{2}|655[0-2][0-9]|6553[0-5]))?(/[^?#[:space:]]*)?$'`),
    check("ai_task_configs_secret_ref_not_blank", sql`length(btrim(${table.secretRef})) > 0`),
    check("ai_task_configs_secret_ref_valid", sql`${table.secretRef} ~ '^[A-Z][A-Z0-9_]{0,127}$'`),
    check("ai_task_configs_status_enabled_consistent", sql`(${table.enabled} and ${table.status} = 'ENABLED' and ${table.taskId} = 'SHOP_HEALTH_REVIEWER') or (not ${table.enabled} and ${table.status} = 'DISABLED')`),
    check("ai_task_configs_parameters_valid", sql`jsonb_typeof(${table.parameters}) = 'object' and (${table.parameters} - array['timeoutMs']) = '{}'::jsonb and case when ${table.parameters} ? 'timeoutMs' then jsonb_typeof(${table.parameters}->'timeoutMs') = 'number' and (${table.parameters}->>'timeoutMs')::numeric between 1 and 300000 and mod((${table.parameters}->>'timeoutMs')::numeric, 1) = 0 else true end`),
    check("ai_task_configs_effective_from_finite", sql`${table.effectiveFrom} not in ('infinity'::timestamptz, '-infinity'::timestamptz)`),
    check("ai_task_configs_created_at_finite", sql`${table.createdAt} not in ('infinity'::timestamptz, '-infinity'::timestamptz)`),
  ],
);

export const refreshSettings = pgTable(
  "refresh_settings",
  {
    singletonId: integer("singleton_id").primaryKey(),
    autoRefreshEnabled: boolean("auto_refresh_enabled").notNull().default(true),
    retryOffsetsMinutes: jsonb("retry_offsets_minutes").$type<number[]>().notNull().default(sql`'[0, 30, 120, 300, 600]'::jsonb`),
    revision: integer("revision").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("refresh_settings_singleton", sql`${table.singletonId} = 1`),
    check("refresh_settings_revision_positive", sql`${table.revision} > 0`),
    check(
      "refresh_settings_retry_offsets_valid",
      sql`refresh_retry_offsets_valid(${table.retryOffsetsMinutes})`,
    ),
    check("refresh_settings_created_at_finite", sql`${table.createdAt} not in ('infinity'::timestamptz, '-infinity'::timestamptz)`),
    check("refresh_settings_updated_at_finite", sql`${table.updatedAt} not in ('infinity'::timestamptz, '-infinity'::timestamptz)`),
  ],
);

export const refreshCheckpoints = pgTable(
  "refresh_checkpoints",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    localTime: text("local_time").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("refresh_checkpoints_local_time_unique").on(table.localTime),
    check("refresh_checkpoints_local_time_valid", sql`${table.localTime} ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'`),
    check("refresh_checkpoints_created_at_finite", sql`${table.createdAt} not in ('infinity'::timestamptz, '-infinity'::timestamptz)`),
    check("refresh_checkpoints_updated_at_finite", sql`${table.updatedAt} not in ('infinity'::timestamptz, '-infinity'::timestamptz)`),
  ],
);

export const decisionCases = pgTable(
  "decision_cases",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    requestId: uuid("request_id").notNull().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "restrict", onUpdate: "cascade" }),
    caseOrigin: decisionDataOriginEnum("case_origin").notNull().default("LIVE"),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    metricsSnapshot: jsonb("metrics_snapshot").$type<DecisionMetricsSnapshot>().notNull(),
    riskSnapshot: jsonb("risk_snapshot").$type<DecisionRiskSnapshot>().notNull(),
    financeSnapshot: jsonb("finance_snapshot").$type<DecisionFinanceSnapshot>().notNull(),
    coverageSnapshot: jsonb("coverage_snapshot").$type<DecisionCoverageSnapshot>(),
    resolvedPolicySnapshot: jsonb("resolved_policy_snapshot").$type<ResolvedRiskPolicySnapshot>(),
    decisionContextSnapshot: jsonb("decision_context_snapshot").$type<AiDecisionContext>(),
    ruleDecision: decisionRuleResultEnum("rule_decision").notNull(),
    ruleTriggers: jsonb("rule_triggers").$type<DecisionRuleTrigger[]>().notNull().default(sql`'[]'::jsonb`),
    dataCoverage: decisionDataCoverageEnum("data_coverage").notNull(),
    sourceSyncRunId: uuid("source_sync_run_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex("decision_cases_request_id_unique").on(table.requestId),
    index("decision_cases_shop_observed_idx").on(table.shopId, table.observedAt),
    index("decision_cases_shop_origin_observed_id_idx").on(
      table.shopId,
      table.caseOrigin,
      table.observedAt,
      table.id
    ),
    index("decision_cases_source_sync_run_idx").on(table.sourceSyncRunId),
    foreignKey({
      columns: [table.shopId, table.caseOrigin],
      foreignColumns: [shops.id, shops.dataOrigin],
      name: "decision_cases_shop_origin_fk"
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
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
      "decision_cases_risk_thresholds_present",
      sql`${table.riskSnapshot} ?& array[
          'stopOnHoldValueAt',
          'stopDeliveryRateBelow',
          'minimumOrdersForRateRule'
        ]
        and jsonb_typeof(${table.riskSnapshot}->'stopOnHoldValueAt') = 'string'
        and jsonb_typeof(${table.riskSnapshot}->'stopDeliveryRateBelow') = 'number'
        and jsonb_typeof(${table.riskSnapshot}->'minimumOrdersForRateRule') = 'number'`
    ),
    check(
      "decision_cases_finance_snapshot_object",
      sql`jsonb_typeof(${table.financeSnapshot}) = 'object'`
    ),
    check(
      "decision_cases_coverage_snapshot_object",
      sql`${table.coverageSnapshot} is null or jsonb_typeof(${table.coverageSnapshot}) = 'object'`
    ),
    check(
      "decision_cases_resolved_policy_snapshot_object",
      sql`${table.resolvedPolicySnapshot} is null or jsonb_typeof(${table.resolvedPolicySnapshot}) = 'object'`
    ),
    check(
      "decision_cases_decision_context_snapshot_object",
      sql`${table.decisionContextSnapshot} is null or jsonb_typeof(${table.decisionContextSnapshot}) = 'object'`
    ),
    check(
      "decision_cases_rule_triggers_array",
      sql`jsonb_typeof(${table.ruleTriggers}) = 'array'`
    ),
    check(
      "decision_cases_demo_has_no_sync_run",
      sql`${table.caseOrigin} <> 'DEMO_SANITIZED' or ${table.sourceSyncRunId} is null`
    )
  ]
);

export const baDecisions = pgTable(
  "ba_decisions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    requestId: uuid("request_id").notNull().defaultRandom(),
    decisionCaseId: uuid("decision_case_id")
      .notNull()
      .references(() => decisionCases.id, { onDelete: "restrict", onUpdate: "cascade" }),
    decision: baDecisionEnum("decision").notNull(),
    reasonCode: text("reason_code").$type<BaDecisionReasonCode>().notNull().default("OTHER"),
    confidence: numeric("confidence", { precision: 7, scale: 6 }),
    reasonCodes: jsonb("reason_codes").$type<BaDecisionReasonCode[]>().notNull(),
    plannedMethods: jsonb("planned_methods").$type<BaPlannedMethod[]>(),
    note: text("note"),
    notes: text("notes"),
    actor: text("actor").notNull().default("LEGACY_UNATTRIBUTED"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex("ba_decisions_request_id_unique").on(table.requestId),
    unique("ba_decisions_id_case_unique").on(table.id, table.decisionCaseId),
    unique("ba_decisions_id_case_decision_unique").on(
      table.id,
      table.decisionCaseId,
      table.decision
    ),
    index("ba_decisions_case_created_idx").on(table.decisionCaseId, table.createdAt),
    check(
      "ba_decisions_confidence_range",
      sql`${table.confidence} is null or (${table.confidence} >= 0 and ${table.confidence} <= 1)`
    ),
    check("ba_decisions_reason_codes_array", sql`jsonb_typeof(${table.reasonCodes}) = 'array'`),
    check(
      "ba_decisions_planned_methods_valid",
      sql`case
        when ${table.decision}::text = 'SLOW_SELL' then
          ${table.plannedMethods} is not null
          and jsonb_typeof(${table.plannedMethods}) = 'array'
          and jsonb_array_length(${table.plannedMethods}) > 0
          and ${table.plannedMethods} <@ '["DISABLE_FLASH_SALE", "INCREASE_PRICE", "OTHER"]'::jsonb
          and jsonb_array_length(${table.plannedMethods}) =
            case when ${table.plannedMethods} ? 'DISABLE_FLASH_SALE' then 1 else 0 end
            + case when ${table.plannedMethods} ? 'INCREASE_PRICE' then 1 else 0 end
            + case when ${table.plannedMethods} ? 'OTHER' then 1 else 0 end
        else ${table.plannedMethods} is null
      end`
    ),
    check(
      "ba_decisions_planned_method_other_requires_notes",
      sql`${table.plannedMethods} is null
        or not (${table.plannedMethods} ? 'OTHER')
        or length(regexp_replace(coalesce(${table.notes}, ${table.note}, ''), E'[[:space:][:cntrl:]\\u200B\\uFEFF]', '', 'g')) > 0`
    ),
    check(
      "ba_decisions_note_not_blank",
      sql`${table.note} is null
        or length(regexp_replace(${table.note}, E'[[:space:][:cntrl:]\\u200B\\uFEFF]', '', 'g')) > 0`
    ),
    check(
      "ba_decisions_notes_not_blank",
      sql`${table.notes} is null
        or length(regexp_replace(${table.notes}, E'[[:space:][:cntrl:]\\u200B\\uFEFF]', '', 'g')) > 0`
    ),
    check("ba_decisions_actor_not_blank", sql`length(btrim(${table.actor})) > 0`),
    check(
      "ba_decisions_other_requires_notes",
      sql`${table.reasonCode} <> 'OTHER'
        or length(regexp_replace(coalesce(${table.notes}, ${table.note}, ''), E'[[:space:][:cntrl:]\\u200B\\uFEFF]', '', 'g')) > 0
        or ${table.actor} = 'LEGACY_UNATTRIBUTED'`
    )
  ]
);

export const aiDecisions = pgTable(
  "ai_decisions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    requestId: uuid("request_id").notNull(),
    decisionCaseId: uuid("decision_case_id")
      .notNull()
      .references(() => decisionCases.id, { onDelete: "restrict", onUpdate: "cascade" }),
    status: aiDecisionStatusEnum("status").notNull(),
    provider: text("provider").notNull(),
    model: text("model"),
    requestedModel: text("requested_model"),
    reportedModel: text("reported_model"),
    actualModelUsed: text("actual_model_used"),
    authMode: text("auth_mode").$type<"LOCAL_NO_AUTH" | "BEARER" | "CONFIG_MISSING">(),
    outputSchemaVersion: text("output_schema_version"),
    promptVersion: text("prompt_version").notNull(),
    policyVersion: text("policy_version").notNull(),
    aiPolicyVersion: text("ai_policy_version"),
    recommendation: baDecisionEnum("recommendation"),
    riskLevel: text("risk_level").$type<"LOW" | "MEDIUM" | "HIGH">(),
    confidence: numeric("confidence", { precision: 7, scale: 6 }),
    ruleOverride: boolean("rule_override"),
    reasonCodes: jsonb("reason_codes").$type<BaDecisionReasonCode[]>(),
    supportingFactors: jsonb("supporting_factors").$type<string[]>(),
    riskFactors: jsonb("risk_factors").$type<string[]>(),
    whatWouldChangeDecision: jsonb("what_would_change_decision").$type<string[]>(),
    reason: text("reason"),
    humanReviewRequired: boolean("human_review_required").notNull(),
    failureCode: text("failure_code").$type<AiFailureCode>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex("ai_decisions_request_id_unique").on(table.requestId),
    unique("ai_decisions_case_unique").on(table.decisionCaseId),
    index("ai_decisions_case_created_idx").on(table.decisionCaseId, table.createdAt),
    check("ai_decisions_provider_not_blank", sql`length(btrim(${table.provider})) > 0`),
    check("ai_decisions_model_not_blank", sql`${table.model} is null or length(btrim(${table.model})) > 0`),
    check("ai_decisions_requested_model_not_blank", sql`${table.requestedModel} is null or length(btrim(${table.requestedModel})) > 0`),
    check("ai_decisions_reported_model_not_blank", sql`${table.reportedModel} is null or length(btrim(${table.reportedModel})) > 0`),
    check("ai_decisions_actual_model_not_blank", sql`${table.actualModelUsed} is null or length(btrim(${table.actualModelUsed})) > 0`),
    check("ai_decisions_auth_mode_known", sql`${table.authMode} is null or ${table.authMode} in ('LOCAL_NO_AUTH', 'BEARER', 'CONFIG_MISSING')`),
    check("ai_decisions_risk_level_known", sql`${table.riskLevel} is null or ${table.riskLevel} in ('LOW', 'MEDIUM', 'HIGH')`),
    check("ai_decisions_prompt_version_not_blank", sql`length(btrim(${table.promptVersion})) > 0`),
    check("ai_decisions_policy_version_not_blank", sql`length(btrim(${table.policyVersion})) > 0`),
    check(
      "ai_decisions_failure_code_known",
      sql`${table.failureCode} is null or ${table.failureCode} in (
        'FEATURE_DISABLED', 'CONFIG_MISSING', 'TIMEOUT', 'NETWORK_ERROR',
        'HTTP_ERROR', 'RATE_LIMITED', 'INVALID_RESPONSE', 'PROVIDER_UNAVAILABLE',
        'MODEL_UNAVAILABLE', 'MODEL_NOT_ALLOWED',
        'MISSING_API_KEY', 'NOT_CONFIGURED', 'MALFORMED_RESPONSE', 'INVALID_OUTPUT'
      )`
    ),
    check(
      "ai_decisions_v1_structured_shape",
      sql`${table.outputSchemaVersion} is null or (
        ${table.outputSchemaVersion} = 'decision-ai-output.v1'
        and ${table.requestedModel} is not null
        and ${table.aiPolicyVersion} is not null
        and ${table.authMode} is not null
        and (
          (${table.status} = 'AVAILABLE'
            and ${table.model} is not null
            and ${table.reportedModel} is not null
            and ${table.actualModelUsed} is not null
            and ${table.riskLevel} is not null
            and ${table.ruleOverride} is not null
            and ${table.supportingFactors} is not null
            and jsonb_typeof(${table.supportingFactors}) = 'array'
            and ${table.riskFactors} is not null
            and jsonb_typeof(${table.riskFactors}) = 'array'
            and ${table.whatWouldChangeDecision} is not null
            and jsonb_typeof(${table.whatWouldChangeDecision}) = 'array')
          or
          (${table.status} = 'UNAVAILABLE'
            and ${table.model} is null
            and ${table.reportedModel} is null
            and ${table.actualModelUsed} is null
            and ${table.riskLevel} is null
            and ${table.ruleOverride} is null
            and ${table.supportingFactors} is null
            and ${table.riskFactors} is null
            and ${table.whatWouldChangeDecision} is null)
        )
      )`
    ),
    check(
      "ai_decisions_available_shape",
      sql`
        (${table.status} = 'AVAILABLE'
          and ${table.recommendation} is not null
          and ${table.confidence} is not null
          and ${table.confidence} >= 0 and ${table.confidence} <= 1
          and ${table.reasonCodes} is not null
          and jsonb_typeof(${table.reasonCodes}) = 'array'
          and jsonb_array_length(${table.reasonCodes}) > 0
          and ${table.reason} is not null and length(btrim(${table.reason})) > 0
          and ${table.failureCode} is null)
        or
        (${table.status} = 'UNAVAILABLE'
          and ${table.recommendation} is null
          and ${table.confidence} is null
          and ${table.reasonCodes} is null
          and ${table.reason} is null
          and ${table.humanReviewRequired}
          and ${table.failureCode} is not null
          and length(btrim(${table.failureCode})) > 0)
      `
    )
  ]
);

export const decisionExecutions = pgTable(
  "decision_executions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    requestId: uuid("request_id").notNull(),
    decisionCaseId: uuid("decision_case_id")
      .notNull()
      .references(() => decisionCases.id, { onDelete: "restrict", onUpdate: "cascade" }),
    baDecisionId: uuid("ba_decision_id").notNull(),
    baDecision: baDecisionEnum("ba_decision").notNull().default("PAUSE"),
    requestedAction: decisionExecutionActionEnum("requested_action").notNull(),
    executionMode: decisionExecutionModeEnum("execution_mode").notNull(),
    executionStatus: decisionExecutionStatusEnum("execution_status").notNull(),
    sellerCenterCalled: boolean("seller_center_called").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex("decision_executions_request_id_unique").on(table.requestId),
    index("decision_executions_ba_decision_idx").on(table.baDecisionId),
    foreignKey({
      columns: [table.baDecisionId, table.decisionCaseId, table.baDecision],
      foreignColumns: [baDecisions.id, baDecisions.decisionCaseId, baDecisions.decision],
      name: "decision_executions_ba_case_decision_fk"
    })
      .onDelete("restrict")
      .onUpdate("cascade"),
    check(
      "decision_executions_dry_run_only",
      sql`${table.requestedAction} = 'HOLIDAY_MODE_ON'
        and ${table.baDecision} = 'PAUSE'
        and ${table.executionMode} = 'DRY_RUN'
        and ${table.executionStatus} = 'SIMULATED'
        and not ${table.sellerCenterCalled}`
    )
  ]
);

export const shopProviderBindings = pgTable(
  "shop_provider_bindings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "restrict", onUpdate: "cascade" }),
    provider: text("provider").notNull(),
    providerShopId: text("provider_shop_id"),
    enabled: boolean("enabled").notNull().default(true),
    provenance: jsonb("provenance").$type<SourceProvenance>().notNull(),
    providerUpdatedAt: timestamp("provider_updated_at", { withTimezone: true }),
    collectedAt: timestamp("collected_at", { withTimezone: true }).notNull().defaultNow(),
    checkpoint: jsonb("checkpoint").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex("shop_provider_bindings_shop_provider_unique").on(table.shopId, table.provider),
    uniqueIndex("shop_provider_bindings_provider_shop_id_unique")
      .on(table.provider, table.providerShopId)
      .where(sql`${table.providerShopId} is not null`),
    index("shop_provider_bindings_enabled_provider_idx")
      .on(table.provider)
      .where(sql`${table.enabled}`),
    check(
      "shop_provider_bindings_provider_known",
      sql`${table.provider} in ('SELLER_CENTER', 'COTIK')`
    ),
    check(
      "shop_provider_bindings_provider_shop_id_not_blank",
      sql`${table.providerShopId} is null or length(btrim(${table.providerShopId})) > 0`
    ),
    check(
      "shop_provider_bindings_enabled_requires_identity",
      sql`not ${table.enabled} or ${table.providerShopId} is not null`
    ),
    check(
      "shop_provider_bindings_provenance_object",
      sql`jsonb_typeof(${table.provenance}) = 'object'
        and ${table.provenance} ? 'source'
        and ${table.provenance} ? 'capabilities'
        and jsonb_typeof(${table.provenance}->'capabilities') = 'array'`
    ),
    check(
      "shop_provider_bindings_provenance_source_matches_provider",
      sql`${table.provenance}->>'source' = ${table.provider}`
    ),
    check(
      "shop_provider_bindings_cotik_no_official_on_hold",
      sql`${table.provider} <> 'COTIK'
        or not (${table.provenance}->'capabilities' ? 'OFFICIAL_ON_HOLD')`
    ),
    check(
      "shop_provider_bindings_checkpoint_object",
      sql`${table.checkpoint} is null or jsonb_typeof(${table.checkpoint}) = 'object'`
    )
  ]
);

export type ShopRow = typeof shops.$inferSelect;
export type AdsPowerProfileRow = typeof adspowerProfiles.$inferSelect;
export type OrderRow = typeof orders.$inferSelect;
export type SettlementRecordRow = typeof settlementRecords.$inferSelect;
export type FinancialSnapshotRow = typeof financialSnapshots.$inferSelect;
export type FinanceCaptureRow = typeof financeCaptures.$inferSelect;
export type FinanceCaptureItemRow = typeof financeCaptureItems.$inferSelect;
export type SyncRunRow = typeof syncRuns.$inferSelect;
export type KpiSnapshotRow = typeof kpiSnapshots.$inferSelect;
export type RiskControlStateRow = typeof riskControlStates.$inferSelect;
export type DecisionCaseRow = typeof decisionCases.$inferSelect;
export type RiskPolicyRevisionRow = typeof riskPolicyRevisions.$inferSelect;
export type AiTaskConfigRow = typeof aiTaskConfigs.$inferSelect;
export type RefreshSettingsRow = typeof refreshSettings.$inferSelect;
export type RefreshCheckpointRow = typeof refreshCheckpoints.$inferSelect;
export type BaDecisionRow = typeof baDecisions.$inferSelect;
export type AiDecisionRow = typeof aiDecisions.$inferSelect;
export type DecisionExecutionRow = typeof decisionExecutions.$inferSelect;
export type ShopProviderBindingRow = typeof shopProviderBindings.$inferSelect;
