export {
  closeDatabase,
  createDatabase,
  pingDatabase,
  type Database,
  type DatabaseContext,
  type DatabaseTransaction
} from "./client.js";
export { readDatabaseConfig, type DatabaseConfig } from "./config.js";
export {
  withCotikCycleExecutionLock,
  withRefreshProfileExecutionLock,
  withShopAdvisoryLock,
  withShopRiskControlLock,
  withTransactionalShopLock
} from "./locks.js";
export { migrateDatabase } from "./migrations.js";
export { seedSanitizedDemoData, type DemoSeedResult } from "./seed-demo.js";
export {
  aiDecisionStatusEnum,
  aiTaskConfigs,
  refreshCheckpointAttemptStatusEnum,
  refreshCheckpointAttempts,
  refreshCheckpointRunStatusEnum,
  refreshCheckpointRuns,
  refreshCheckpoints,
  refreshSettings,
  aiDecisions,
  cotikSupplementaryPayments,
  cotikSupplementaryStatements,
  adspowerProfileVerificationStateEnum,
  adspowerProfiles,
  baDecisionEnum,
  baDecisions,
  canonicalOrderStatusEnum,
  decisionCases,
  decisionDataCoverageEnum,
  decisionDataOriginEnum,
  decisionExecutionActionEnum,
  decisionExecutionModeEnum,
  decisionExecutionStatusEnum,
  decisionExecutions,
  decisionRuleResultEnum,
  evaluationStatusEnum,
  financeCaptureItems,
  financeCaptures,
  financialSnapshots,
  kpiSnapshots,
  orders,
  recommendationEnum,
  riskActionStatusEnum,
  riskControlStates,
  riskDesiredStateEnum,
  riskPolicyRevisions,
  riskPolicyScopeEnum,
  settlementRecords,
  settlementStateEnum,
  shops,
  shopProviderBindings,
  shopEligibilityStatusEnum,
  shopVerificationStatusEnum,
  shopSyncStateEnum,
  syncModeEnum,
  syncRuns,
  syncRunStatusEnum,
  type AiDecisionRow,
  type CotikSupplementaryPaymentRow,
  type CotikSupplementaryStatementRow,
  type AiTaskConfigRow,
  type RefreshCheckpointAttemptRow,
  type RefreshCheckpointRunRow,
  type RefreshCheckpointRow,
  type RefreshSettingsRow,
  type AdsPowerProfileRow,
  type BaDecisionRow,
  type DecisionCaseRow,
  type DecisionExecutionRow,
  type FinanceCaptureItemRow,
  type FinanceCaptureRow,
  type FinancialSnapshotRow,
  type KpiSnapshotRow,
  type OrderRow,
  type RiskControlStateRow,
  type RiskPolicyRevisionRow,
  type SettlementRecordRow,
  type ShopRow,
  type SyncRunRow
} from "./schema.js";
export {
  captureBaDecision,
  createDecisionCase,
  getDecisionAiInput,
  getLatestDecisionContext,
  getDecisionReview,
  getDecisionReviewByRequestId,
  listDecisionHistory,
  recordAiDecision,
  recordBaDecisionForCase,
  recordDryRunExecution,
  type AiDecisionInput,
  type BaDecisionInput,
  type CaptureBaDecisionInput,
  type CapturedBaDecision,
  type CreateDecisionCaseInput,
  type DecisionCaseInput,
  type DecisionAiInputRecord,
  type DecisionBaRevision,
  type DecisionHistoryPageRecord,
  type DecisionReviewRecord,
  type ListDecisionHistoryInput,
  type RecordBaDecisionForCaseInput,
  type RecordDryRunExecutionInput,
} from "./queries/decisions.js";
export {
  listCotikSupplementaryStatementsWithPayments,
  upsertCotikSupplementaryPaymentBatch,
  upsertCotikSupplementaryStatementBatch,
  type CotikSupplementaryPaymentUpsertInput,
  type CotikSupplementaryStatementUpsertInput,
  type CotikSupplementaryStatementWithPayment,
} from "./queries/cotik-supplementary-finance.js";
export {
  buildDecisionFinanceSnapshot,
  finalizeFinanceSyncRun,
  getFinanceSummary,
  getLatestFinancialSnapshotAtOrBefore,
  getLatestFinancialSnapshot,
  normalizeFinanceReasonSummary,
  insertFinancialSnapshot,
  listOnHoldSettlements,
  listSettlementsForMetrics,
  upsertSettlementBatch,
  type FinanceSummary,
  type DecisionFinanceSnapshotInput,
  type DecisionFinanceReasonSummary,
  type FinalizeFinanceSyncRunInput,
  type FinalizeFinanceSyncRunResult,
  type FinancialSnapshotInput,
  type SettlementUpsertInput
} from "./queries/finance.js";
export {
  getLatestKpiSnapshot,
  insertKpiSnapshot,
  listKpiSnapshots,
  type KpiSnapshotInput
} from "./queries/kpi.js";
export {
  getMetricsInput,
  getObjectiveMetricsSourceRows,
  getMetricsSourceRows,
  type MetricsSourceRows
} from "./queries/metrics-input.js";
export {
  getFullPersistedRiskOrderFacts,
  listOrders,
  listOrdersForMetrics,
  listOrdersForRisk,
  upsertOrderBatch,
  type ListOrdersInput,
  type OrderUpsertInput,
  type RiskOrderFactRow,
  type UpsertBatchResult
} from "./queries/orders.js";
export {
  buildOrderExplorerSummary,
  getOrderExplorerDetail,
  listOrderExplorerItems,
  summarizeOrderExplorerRecords,
  toOrderExplorerDetail,
  toOrderExplorerListItem,
  type ListOrderExplorerInput,
  type OrderExplorerDetail,
  type OrderExplorerListItem,
  type OrderExplorerStatusBucket,
  type OrderExplorerSummary,
} from "./queries/order-explorer.js";
export {
  appendGlobalRiskPolicyRevision,
  appendShopRiskPolicyOverrideRevision,
  disableShopRiskPolicyOverride,
  getEffectiveRiskPolicy,
  type AppendGlobalRiskPolicyRevisionInput,
  type AppendShopRiskPolicyOverrideRevisionInput,
  type DisableShopRiskPolicyOverrideInput,
  type GetEffectiveRiskPolicyInput,
} from "./queries/risk-policy.js";
export {
  appendAiTaskConfigRevision,
  getCurrentAiTaskConfig,
  getAiTaskConfigByRevision,
  type AppendAiTaskConfigRevisionInput,
  type GetCurrentAiTaskConfigInput,
} from "./queries/ai-task-configs.js";
export {
  addRefreshCheckpoint,
  deleteRefreshCheckpoint,
  getCurrentRefreshSettings,
  setAutoRefreshEnabled,
  setRefreshCheckpointEnabled,
  setRefreshRetryOffsets,
  updateRefreshCheckpoint,
  type AddRefreshCheckpointInput,
  type DeleteRefreshCheckpointInput,
  type RefreshCheckpoint,
  type RefreshSettingsSnapshot,
  type SetAutoRefreshEnabledInput,
  type SetRefreshCheckpointEnabledInput,
  type SetRefreshRetryOffsetsInput,
  type UpdateRefreshCheckpointInput,
} from "./queries/refresh-settings.js";
export {
  claimDueRefreshAttempts,
  completeRefreshAttempt,
  getRefreshCheckpointRun,
  recordRefreshAttemptStarted,
  recordRefreshAttemptProxyPreflight,
  releaseRefreshClaim,
  renewRefreshAttemptLease,
  type ClaimDueRefreshAttemptsInput,
  type CompleteRefreshAttemptInput,
  type GetRefreshCheckpointRunInput,
  type RecordRefreshAttemptStartedInput,
  type RecordRefreshAttemptProxyPreflightInput,
  type ReleaseRefreshClaimInput,
  type RenewRefreshAttemptLeaseInput,
} from "./queries/refresh-controller.js";
export {
  getRiskControlState,
  recordHolidayModeObservation,
  recordRiskControlAction,
  saveRiskControlEvaluation,
  type RecordHolidayModeObservationInput,
  type RecordRiskControlActionInput,
  type SaveRiskControlEvaluationInput
} from "./queries/risk-control.js";
export {
  createAdsPowerProfile,
  getAdsPowerProfile,
  listAdsPowerProfiles,
  listAutomaticRefreshEligibleAdsPowerProfileShops,
  listReadyAdsPowerProfileShops,
  ADSPOWER_OBSERVED_STATUS_MAX_AGE_MS,
  linkAdsPowerProfileToShop,
  setAdsPowerProfileObservedStatus,
  setAdsPowerProfileVerification,
  type CreateAdsPowerProfileInput,
  type SetAdsPowerProfileObservedStatusInput,
  type SetAdsPowerProfileVerificationInput,
} from "./queries/adspower-profiles.js";
export {
  createShop,
  findShopById,
  findShopByProfileId,
  findShopByProfileNo,
  findShopByTikTokShopId,
  listEnabledShops,
  listShops,
  markShopSynced,
  requestShopSync,
  setShopSyncState,
  setShopVerificationState,
  updateShopDisplayName,
  unlinkShopByProfileNo,
  type CreateShopInput,
  type SetShopVerificationStateInput,
  type ShopSyncState
} from "./queries/shops.js";
export {
  abortStaleSyncRuns,
  beginSyncRun,
  completeSyncRun,
  failSyncRun,
  findLatestSuccessfulSyncRun,
  findLatestCheckpoint,
  listSyncRuns,
  updateSyncCheckpoint,
  type BeginSyncRunInput,
  type CompleteSyncRunInput,
  type FailSyncRunInput,
  type SyncMode
} from "./queries/sync-runs.js";
export {
  disableShopProviderBinding,
  findEnabledShopProviderBinding,
  listEnabledShopProviderBindings,
  listEnabledCotikBoundShops,
  upsertShopProviderBinding,
  type ShopProviderBindingRow,
  type UpsertShopProviderBindingInput
} from "./queries/provider-bindings.js";

// --- W2-T02 appended exports (isolated hunk; do not merge with pre-existing WIP) ---
export {
  shopProviderBindingCheckpointSchema,
  updateShopProviderBindingCheckpoint
} from "./queries/provider-bindings.js";

// --- W21-T01 Cotik Multi-Account Foundation exports ---
export {
  bytea,
  cotikAccounts,
  cotikAccountSecrets,
  cotikLogicalShops,
  cotikAccountShops,
  cotikWorkflowSettings,
  cotikProviderCatalog,
  cotikProviderRules,
  type CotikAccountRow,
  type CotikAccountSecretRow,
  type CotikLogicalShopRow,
  type CotikAccountShopRow,
  type CotikWorkflowSettingsRow,
  type CotikProviderCatalogRow,
  type CotikProviderRuleRow
} from "./schema.js";

export {
  encryptCotikToken,
  decryptCotikToken,
  getVaultKey,
  getVaultKeyring,
  parseCotikVaultKeyring,
  type CotikVaultKeyring,
  type CotikVaultKeyringEntry,
  type CotikTokenDecryptionOptions,
  createCotikAccount,
  upsertCotikAccount,
  setCotikAccountToken,
  getDecryptedCotikToken,
  findCotikAccountById,
  listActiveCotikAccounts,
  listCotikAccounts,
  updateCotikAccountStatus,
  deleteCotikAccount,
  type CreateCotikAccountInput,
  type EncryptedSecretPayload
} from "./queries/cotik-accounts.js";

export {
  upsertCotikLogicalShop,
  findCotikLogicalShopByMaShopNoiBo,
  findCotikLogicalShopById,
  listCotikLogicalShops,
  upsertCotikAccountShop,
  listCotikAccountShopsByAccount,
  listCotikAccountShopsByLogicalShop,
  updateCotikAccountShopDiscoveryState,
  updateCotikAccountShopCheckpoint,
  type UpsertCotikLogicalShopInput,
  type UpsertCotikAccountShopInput
} from "./queries/cotik-shops.js";

export {
  upsertProviderCatalogEntry,
  seedProviderCatalog,
  listProviderCatalog,
  createProviderRule,
  seedProviderRules,
  listProviderRules,
  type UpsertProviderCatalogInput,
  type CreateProviderRuleInput
} from "./queries/provider-catalog.js";

// --- W21-T02 Cotik Observation & Winner Projection exports ---
export {
  cotikOrderObservations,
  cotikOrders,
  cotikOrderItems,
  type CotikOrderObservationRow,
  type CotikOrderRow,
  type CotikOrderItemRow
} from "./schema.js";

export {
  recordCotikOrderObservation,
  recordCotikOrderObservations,
  listObservationsForOrder
} from "./queries/cotik-observations.js";

export {
  projectWinningCotikOrder,
  pickWinningCotikObservation,
  isEligibleCotikWinnerCandidate,
  shouldPersistCotikOrderItems,
  type CotikWinningObservationCandidate,
  findCotikOrderById,
  listCotikOrderItems,
  type ProjectWinningOrderInput
} from "./queries/cotik-orders-multi.js";

// --- W21 Phase 2B Cotik POST Writer & Tracking exports ---
export {
  cotikTrackingCandidates,
  cotikTrackingRuns,
  cotikPostIntents,
  cotikPostAttempts,
  type CotikTrackingCandidateRow,
  type CotikTrackingRunRow,
  type CotikPostIntentRow,
  type CotikPostAttemptRow
} from "./schema.js";

export {
  getCotikWorkflowSettings,
  ensureCotikWorkflowSettings,
  setCotikWorkflowSettings,
  resetCotikWorkflowSettingsForDeployment,
  type SetCotikWorkflowSettingsInput,
  type DeploymentResetResult
} from "./queries/cotik-workflow.js";

export {
  computeTrackingFingerprint,
  LEGACY_COTIK_TRACKING_RUN_ID,
  createCotikTrackingReplayRun,
  getCotikTrackingRunById,
  createTrackingCandidate,
  createOrGetPostIntent,
  recordPostAttempt,
  stageConfirmedPostIntentForReplay,
  listPendingPostIntents,
  listInProgressPostIntents,
  getPostIntentById,
  getPostIntentByFingerprint,
  findPostIntentForTracking,
  listAttemptsForIntent,
  type CreateTrackingCandidateInput,
  type CreateCotikTrackingReplayRunInput,
  type CreatePostIntentInput,
  type StageConfirmedPostIntentForReplayInput,
  type FindPostIntentForTrackingInput,
  type RecordPostAttemptInput
} from "./queries/cotik-tracking.js";
