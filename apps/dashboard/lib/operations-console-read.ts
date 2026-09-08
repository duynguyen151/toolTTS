import {
  closeDatabase,
  createDatabase,
  findShopByProfileNo,
  getFinanceSummary,
  getFullPersistedRiskOrderFacts,
  getLatestKpiSnapshot,
  listAdsPowerProfiles,
  listDecisionHistory,
  listShops,
  listSyncRuns,
  type AdsPowerProfileRow,
  type Database,
  type DecisionReviewRecord,
  type ShopRow,
  type SyncRunRow,
} from "@shop-health/db";
import { AdsPowerClient, type AdsPowerProfileTag } from "@shop-health/seller-center/adspower";

import type {
  ConsoleShopDetail,
  ConsoleShopsFilter,
  ConsoleShopSummary,
  PaginatedResult,
  ShopDataCoverageState,
  ShopEligibilityState,
  ShopVerificationState,
} from "./operations-console-contract.js";
import { loadDashboardPresentation } from "./dashboard-read.js";

const DISPLAY_TIME_ZONE = "Asia/Bangkok";

function formatMoney(amount: string | null, currency: string): string {
  if (amount === null) return "Chưa khả dụng";
  const numeric = Number(amount);
  if (!Number.isFinite(numeric)) return "Chưa khả dụng";
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: currency === "USD" ? "USD" : currency,
    maximumFractionDigits: 2,
  }).format(numeric);
}

function formatIso(date: Date | string | null | undefined): string | null {
  if (!date) return null;
  const d = date instanceof Date ? date : new Date(date);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function formatTimestamp(value: Date | string | null | undefined): string {
  if (!value) return "Chưa khả dụng";
  const timestamp = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(timestamp.getTime())) return "Chưa khả dụng";
  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: DISPLAY_TIME_ZONE,
  }).format(timestamp);
}

function computeCoverageState(review: DecisionReviewRecord | null): ShopDataCoverageState {
  if (!review) return "UNAVAILABLE";
  const state = review.coverageSnapshot.coverageState;
  if (state === "COMPLETE") return "READY";
  if (state === "PARTIAL") return "PARTIAL";
  return "UNAVAILABLE";
}

export async function readConsoleShops(
  databaseUrl: string | undefined,
  filter: ConsoleShopsFilter = {},
  adsPowerClient?: AdsPowerClient,
): Promise<PaginatedResult<ConsoleShopSummary>> {
  if (!databaseUrl?.trim()) {
    return {
      items: [],
      totalItems: 0,
      page: filter.page ?? 1,
      pageSize: filter.pageSize ?? 20,
      totalPages: 0,
    };
  }

  const context = createDatabase(databaseUrl);
  try {
    const [allDbShops, dbProfiles, adsProfiles] = await Promise.all([
      listShops(context.db),
      listAdsPowerProfiles(context.db).catch(() => [] as AdsPowerProfileRow[]),
      adsPowerClient ? adsPowerClient.listProfiles().catch(() => []) : Promise.resolve([]),
    ]);

    const allShops = allDbShops.filter(
      (s) => s.profileNo !== "DEMO-001" && s.dataOrigin !== "DEMO_SANITIZED",
    );

    const profileMap = new Map<string, AdsPowerProfileRow>();
    for (const p of dbProfiles) {
      profileMap.set(p.profileNo, p);
    }

    const liveAdsMap = new Map<string, { state: "OPEN" | "CLOSED" | "ERROR"; groupName: string | null; tags: readonly AdsPowerProfileTag[] }>();
    for (const p of adsProfiles) {
      liveAdsMap.set(p.profileNo, { state: p.state, groupName: p.groupName, tags: p.tags });
    }

    const shopMap = new Map<string, ShopRow>();
    for (const s of allShops) {
      shopMap.set(s.profileNo, s);
    }

    const shopOrdersMap = new Map<string, { total: number; inTransit: number; delivered: number; completed: number; awaiting: number }>();
    try {
      if (context.db.query?.orders?.findMany) {
        const ordersRows = await context.db.query.orders.findMany({
          columns: { shopId: true, canonicalStatus: true },
        });
        for (const o of ordersRows as any[]) {
          let s = shopOrdersMap.get(o.shopId);
          if (!s) {
            s = { total: 0, inTransit: 0, delivered: 0, completed: 0, awaiting: 0 };
            shopOrdersMap.set(o.shopId, s);
          }
          s.total += 1;
          if (o.canonicalStatus === "IN_TRANSIT") s.inTransit += 1;
          else if (o.canonicalStatus === "DELIVERED") s.delivered += 1;
          else if (o.canonicalStatus === "COMPLETED") s.completed += 1;
          else if (o.canonicalStatus === "AWAITING_SHIPMENT" || o.canonicalStatus === "AWAITING_COLLECTION" || o.canonicalStatus === "PENDING" || o.canonicalStatus === "UNPAID") s.awaiting += 1;
        }
      }
    } catch {
      // ignore
    }

    const buildLinkedSummary = async (
      shop: ShopRow,
      dbProfile: AdsPowerProfileRow | undefined,
      liveAds: { state: "OPEN" | "CLOSED" | "ERROR"; groupName: string | null; tags: readonly AdsPowerProfileTag[] } | undefined,
    ): Promise<ConsoleShopSummary> => {
      const [decisionPage, kpiSnapshot, finance, cotikBinding] = await Promise.all([
        listDecisionHistory(context.db, { profileNo: shop.profileNo, limit: 1 }).catch(() => ({ items: [], nextCursor: null })),
        getLatestKpiSnapshot(context.db, shop.id).catch(() => null),
        getFinanceSummary(context.db, shop.id).catch(() => ({ latestSnapshot: null, statementsCount: 0 })),
        context.db.query?.shopProviderBindings?.findFirst
          ? context.db.query.shopProviderBindings.findFirst({
              where: (table: any, { eq, and }: any) => and(eq(table.shopId, shop.id), eq(table.provider, "COTIK")),
            }).catch(() => null)
          : Promise.resolve(null),
      ]);

      const latestReview = decisionPage.items[0] ?? null;
      const metrics = kpiSnapshot?.metrics as Record<string, unknown> | undefined;
      const orderMetrics = metrics && typeof metrics.orders === "object" && metrics.orders !== null ? (metrics.orders as Record<string, unknown>) : undefined;
      const deliveryMetric = metrics && typeof metrics.deliveryRate === "object" && metrics.deliveryRate !== null ? (metrics.deliveryRate as Record<string, unknown>) : undefined;

      const directStats = shopOrdersMap.get(shop.id);
      let calculatedDeliveryRate: number | null = null;
      if (directStats) {
        const num = directStats.delivered + directStats.completed + directStats.inTransit;
        const den = num + directStats.awaiting;
        if (den > 0) {
          calculatedDeliveryRate = Number(((num / den) * 100).toFixed(1));
        }
      }

      const totalOrders = latestReview?.metrics.totalOrders
        ?? (typeof orderMetrics?.total === "number" ? orderMetrics.total : null)
        ?? (directStats?.total != null && directStats.total > 0 ? directStats.total : null);
      const deliveryRate = latestReview?.metrics.deliveryRate
        ?? (typeof deliveryMetric?.value === "number" ? deliveryMetric.value : null)
        ?? calculatedDeliveryRate;
      const cotikProv = cotikBinding?.provenance as Record<string, unknown> | undefined;
      const cotikOnHoldVal = cotikProv?.sumEstSettlementAmount != null
        ? String(cotikProv.sumEstSettlementAmount)
        : null;

      const onHoldAmount = latestReview?.metrics.onHoldValue
        ?? finance.latestSnapshot?.officialOnHoldAmount
        ?? cotikOnHoldVal
        ?? null;

      const verificationState: ShopVerificationState = (dbProfile?.verificationState as ShopVerificationState)
        ?? (shop.verificationStatus === "VERIFIED" ? "READY" : "UNVERIFIED");

      const eligibilityStatus: ShopEligibilityState = (dbProfile?.eligibilityStatus as ShopEligibilityState)
        ?? (shop.eligibilityStatus as ShopEligibilityState)
        ?? "INELIGIBLE";

      const ruleResult = latestReview?.rule.decision ?? null;
      const aiRecommendation = latestReview?.ai?.status === "AVAILABLE" ? latestReview.ai.recommendation : null;

      const hasCotik = Boolean(cotikBinding?.enabled);
      const parsedDeliveryRate = deliveryRate != null
        ? (deliveryRate <= 1 && deliveryRate > 0 ? deliveryRate * 100 : Number(deliveryRate))
        : null;
      const isDeliveryLow = parsedDeliveryRate !== null && !Number.isNaN(parsedDeliveryRate) && parsedDeliveryRate < 70;

      let compositeHealth: "HEALTHY" | "AT_RISK" | "DATA_BLOCKED" = "HEALTHY";
      if (!hasCotik || shop.syncState === "DISABLED") {
        compositeHealth = "DATA_BLOCKED";
      } else if (ruleResult === "PAUSE" || aiRecommendation === "PAUSE" || isDeliveryLow || shop.syncState.startsWith("PAUSED_")) {
        compositeHealth = "AT_RISK";
      } else {
        compositeHealth = "HEALTHY";
      }

      return {
        id: shop.id,
        profileId: shop.profileId,
        profileNo: shop.profileNo,
        displayName: shop.displayName ?? shop.profileNo,
        region: shop.region,
        locale: shop.locale,
        currency: shop.currency,
        enabled: shop.enabled,
        syncState: (shop.syncState as any) ?? "IDLE",
        pauseReason: shop.pauseReason,
        verificationState,
        eligibilityStatus,
        verifiedTiktokShopId: dbProfile?.verifiedTiktokShopId ?? shop.tiktokShopId ?? null,
        verifiedShopDisplayName: dbProfile?.verifiedShopDisplayName ?? shop.displayName ?? null,
        lastVerifiedAt: formatIso(dbProfile?.lastVerifiedAt),
        lastOrdersSyncedAt: formatIso(shop.lastOrdersSyncedAt),
        lastFinanceSyncedAt: formatIso(shop.lastFinanceSyncedAt),
        dataOrigin: (shop.dataOrigin as any) ?? "LIVE",
        totalOrders,
        onHoldAmount,
        deliveryRate,
        latestRecommendation: ruleResult,
        latestAiRecommendation: aiRecommendation,
        latestBaDecision: latestReview?.ba?.decision ?? null,
        activeDecisionCaseId: latestReview?.case.id ?? null,
        adsPowerState: liveAds?.state,
        groupName: liveAds?.groupName ?? null,
        tags: liveAds?.tags ?? [],
        cotikBinding: cotikBinding ? {
          enabled: cotikBinding.enabled,
          cotikShopId: cotikBinding.providerShopId ?? "",
          lastOrdersSyncedAt: formatIso(cotikBinding.providerUpdatedAt),
          lastFinanceSyncedAt: formatIso(cotikBinding.providerUpdatedAt),
          sumEstSettlementAmount: typeof cotikProv?.sumEstSettlementAmount === "number" ? cotikProv.sumEstSettlementAmount : null,
          estimatedSettlement: typeof cotikProv?.estimatedSettlement === "string" ? cotikProv.estimatedSettlement : null,
          onHoldBuckets: (cotikProv?.onHoldBuckets as any) ?? null,
        } : null,
        compositeHealth,
      };
    };

    let summaries: ConsoleShopSummary[] = [];

    if (adsProfiles.length > 0) {
      const seenProfileNos = new Set<string>();

      const adsSummaries = await Promise.all(
        adsProfiles.map(async (adsProfile) => {
          seenProfileNos.add(adsProfile.profileNo);
          const shop = shopMap.get(adsProfile.profileNo);
          const dbProfile = profileMap.get(adsProfile.profileNo);

          if (shop) {
            return buildLinkedSummary(shop, dbProfile, {
              state: adsProfile.state,
              groupName: adsProfile.groupName,
              tags: adsProfile.tags,
            });
          }

          return {
            id: `unlinked-${adsProfile.profileId}`,
            profileId: adsProfile.profileId,
            profileNo: adsProfile.profileNo,
            displayName: `Profile #${adsProfile.profileNo} (Chưa liên kết)`,
            region: "US",
            locale: "en-US",
            currency: "USD",
            enabled: false,
            syncState: "IDLE" as const,
            pauseReason: null,
            verificationState: ((dbProfile?.verificationState as ShopVerificationState) ?? "UNVERIFIED"),
            eligibilityStatus: ((dbProfile?.eligibilityStatus as ShopEligibilityState) ?? "INELIGIBLE"),
            verifiedTiktokShopId: dbProfile?.verifiedTiktokShopId ?? null,
            verifiedShopDisplayName: dbProfile?.verifiedShopDisplayName ?? null,
            lastVerifiedAt: formatIso(dbProfile?.lastVerifiedAt),
            lastOrdersSyncedAt: null,
            lastFinanceSyncedAt: null,
            dataOrigin: "LIVE" as const,
            totalOrders: null,
            onHoldAmount: null,
            deliveryRate: null,
            latestRecommendation: null,
            latestBaDecision: null,
            activeDecisionCaseId: null,
            adsPowerState: adsProfile.state,
            groupName: adsProfile.groupName,
            tags: adsProfile.tags,
          };
        }),
      );

      const remainingDbShops = allShops.filter((shop) => !seenProfileNos.has(shop.profileNo));
      const remainingSummaries = await Promise.all(
        remainingDbShops.map((shop) => {
          const dbProfile = profileMap.get(shop.profileNo);
          const liveAds = liveAdsMap.get(shop.profileNo);
          return buildLinkedSummary(shop, dbProfile, liveAds);
        }),
      );

      summaries = [...adsSummaries, ...remainingSummaries];
    } else {
      summaries = await Promise.all(
        allShops.map((shop) => {
          const dbProfile = profileMap.get(shop.profileNo);
          const liveAds = liveAdsMap.get(shop.profileNo);
          return buildLinkedSummary(shop, dbProfile, liveAds);
        }),
      );
    }

    // Apply filtering
    let filtered = summaries.filter(
      (s) => s.profileNo !== "DEMO-001" && s.dataOrigin !== "DEMO_SANITIZED",
    );
    if (filter.query?.trim()) {
      const q = filter.query.trim().toLowerCase();
      filtered = filtered.filter(
        (s) =>
          s.profileNo.toLowerCase().includes(q) ||
          s.displayName.toLowerCase().includes(q) ||
          (s.verifiedTiktokShopId && s.verifiedTiktokShopId.toLowerCase().includes(q)) ||
          (s.groupName && s.groupName.toLowerCase().includes(q)),
      );
    }

    if (filter.syncState) {
      filtered = filtered.filter((s) => s.syncState === filter.syncState);
    }

    if (filter.verificationState) {
      filtered = filtered.filter((s) => s.verificationState === filter.verificationState);
    }

    if (filter.recommendation) {
      filtered = filtered.filter((s) => s.latestRecommendation === filter.recommendation);
    }

    // Sort
    const sortBy = filter.sortBy ?? "profileNo";
    const sortOrder = filter.sortOrder ?? "asc";
    filtered.sort((a, b) => {
      let cmp = 0;
      if (sortBy === "profileNo") cmp = a.profileNo.localeCompare(b.profileNo, undefined, { numeric: true });
      else if (sortBy === "displayName") cmp = a.displayName.localeCompare(b.displayName);
      else if (sortBy === "totalOrders") cmp = (a.totalOrders ?? -1) - (b.totalOrders ?? -1);
      else if (sortBy === "onHoldAmount") cmp = Number(a.onHoldAmount ?? 0) - Number(b.onHoldAmount ?? 0);
      else if (sortBy === "lastSyncedAt") {
        const tA = Math.max(
          a.lastOrdersSyncedAt ? new Date(a.lastOrdersSyncedAt).getTime() : 0,
          a.lastFinanceSyncedAt ? new Date(a.lastFinanceSyncedAt).getTime() : 0,
        );
        const tB = Math.max(
          b.lastOrdersSyncedAt ? new Date(b.lastOrdersSyncedAt).getTime() : 0,
          b.lastFinanceSyncedAt ? new Date(b.lastFinanceSyncedAt).getTime() : 0,
        );
        cmp = tA - tB;
      }
      return sortOrder === "desc" ? -cmp : cmp;
    });

    const page = Math.max(1, filter.page ?? 1);
    const pageSize = Math.max(1, Math.min(200, filter.pageSize ?? 20));
    const totalItems = filtered.length;
    const totalPages = Math.ceil(totalItems / pageSize);
    const startIndex = (page - 1) * pageSize;
    const paginatedItems = filtered.slice(startIndex, startIndex + pageSize);

    return {
      items: paginatedItems,
      totalItems,
      page,
      pageSize,
      totalPages,
    };
  } finally {
    await closeDatabase(context);
  }
}

export async function readConsoleShopDetail(
  databaseUrl: string | undefined,
  profileNo: string,
  adsPowerClient?: AdsPowerClient,
): Promise<ConsoleShopDetail | null> {
  if (!databaseUrl?.trim() || !profileNo?.trim()) return null;

  const context = createDatabase(databaseUrl);
  try {
    const shop = await findShopByProfileNo(context.db, profileNo);
    if (!shop) return null;

    const [
      dbProfiles,
      adsProfiles,
      decisionPage,
      syncRunsList,
      kpiSnapshot,
      orderFacts,
      financeSummary,
      presentation,
      cotikBinding,
    ] = await Promise.all([
      listAdsPowerProfiles(context.db).catch(() => [] as AdsPowerProfileRow[]),
      adsPowerClient ? adsPowerClient.listProfiles().catch(() => []) : Promise.resolve([]),
      listDecisionHistory(context.db, { profileNo, limit: 10 }).catch(() => ({ items: [], nextCursor: null })),
      listSyncRuns(context.db, shop.id, 20).catch(() => [] as SyncRunRow[]),
      getLatestKpiSnapshot(context.db, shop.id).catch(() => null),
      getFullPersistedRiskOrderFacts(context.db, shop.id).catch(() => []),
      getFinanceSummary(context.db, shop.id).catch(() => ({ latestSnapshot: null, statementsCount: 0 })),
      loadDashboardPresentation(profileNo),
      context.db.query?.shopProviderBindings?.findFirst
        ? context.db.query.shopProviderBindings.findFirst({
            where: (table: any, { eq, and }: any) => and(eq(table.shopId, shop.id), eq(table.provider, "COTIK")),
          }).catch(() => null)
        : Promise.resolve(null),
    ]);

    const dbProfile = dbProfiles.find((p) => p.profileNo === profileNo);
    const liveAds = adsProfiles.find((p) => p.profileNo === profileNo);
    const latestReview = decisionPage.items[0] ?? null;

    const metrics = kpiSnapshot?.metrics as Record<string, unknown> | undefined;
    const orderMetrics = metrics && typeof metrics.orders === "object" && metrics.orders !== null ? (metrics.orders as Record<string, unknown>) : undefined;
    const deliveryMetric = metrics && typeof metrics.deliveryRate === "object" && metrics.deliveryRate !== null ? (metrics.deliveryRate as Record<string, unknown>) : undefined;

    const factsTotal = orderFacts.reduce((sum, f) => sum + f.orderCount, 0);
    const totalOrders = orderFacts.length > 0
      ? factsTotal
      : (latestReview?.metrics.totalOrders ?? (typeof orderMetrics?.total === "number" ? orderMetrics.total : null));

    const directNum = orderFacts.filter(f => f.canonicalStatus === "DELIVERED" || f.canonicalStatus === "COMPLETED" || f.canonicalStatus === "IN_TRANSIT").reduce((sum, f) => sum + f.orderCount, 0);
    const directAwaiting = orderFacts.filter(f => f.canonicalStatus === "AWAITING_SHIPMENT" || f.canonicalStatus === "AWAITING_COLLECTION" || f.canonicalStatus === "PENDING" || f.canonicalStatus === "UNPAID").reduce((sum, f) => sum + f.orderCount, 0);
    const directDen = directNum + directAwaiting;
    const directDeliveryRate = directDen > 0 ? Number(((directNum / directDen) * 100).toFixed(1)) : null;

    const deliveryRate = latestReview?.metrics.deliveryRate
      ?? (typeof deliveryMetric?.value === "number" ? deliveryMetric.value : null)
      ?? directDeliveryRate;

    const cotikProv = cotikBinding?.provenance as Record<string, unknown> | undefined;
    const cotikOnHoldVal = cotikProv?.sumEstSettlementAmount != null
      ? String(cotikProv.sumEstSettlementAmount)
      : null;

    const onHoldAmount = latestReview?.metrics.onHoldValue
      ?? financeSummary.latestSnapshot?.officialOnHoldAmount
      ?? cotikOnHoldVal
      ?? null;

    const verificationState: ShopVerificationState = (dbProfile?.verificationState as ShopVerificationState)
      ?? (shop.verificationStatus === "VERIFIED" ? "READY" : "UNVERIFIED");

    const eligibilityStatus: ShopEligibilityState = (dbProfile?.eligibilityStatus as ShopEligibilityState)
      ?? (shop.eligibilityStatus as ShopEligibilityState)
      ?? "INELIGIBLE";

    const shopSummary: ConsoleShopSummary = {
      id: shop.id,
      profileId: shop.profileId,
      profileNo: shop.profileNo,
      displayName: shop.displayName ?? shop.profileNo,
      region: shop.region,
      locale: shop.locale,
      currency: shop.currency,
      enabled: shop.enabled,
      syncState: (shop.syncState as any) ?? "IDLE",
      pauseReason: shop.pauseReason,
      verificationState,
      eligibilityStatus,
      verifiedTiktokShopId: dbProfile?.verifiedTiktokShopId ?? shop.tiktokShopId ?? null,
      verifiedShopDisplayName: dbProfile?.verifiedShopDisplayName ?? shop.displayName ?? null,
      lastVerifiedAt: formatIso(dbProfile?.lastVerifiedAt),
      lastOrdersSyncedAt: formatIso(shop.lastOrdersSyncedAt),
      lastFinanceSyncedAt: formatIso(shop.lastFinanceSyncedAt),
      dataOrigin: "LIVE",
      totalOrders,
      onHoldAmount,
      deliveryRate,
      latestRecommendation: latestReview?.rule.decision ?? null,
      latestBaDecision: latestReview?.ba?.decision ?? null,
      activeDecisionCaseId: latestReview?.case.id ?? null,
      adsPowerState: liveAds?.state,
      groupName: liveAds?.groupName ?? null,
      tags: liveAds?.tags ?? [],
      cotikBinding: cotikBinding ? {
        enabled: cotikBinding.enabled,
        cotikShopId: cotikBinding.providerShopId ?? "",
        lastOrdersSyncedAt: formatIso(shop.lastOrdersSyncedAt),
        lastFinanceSyncedAt: formatIso(shop.lastFinanceSyncedAt),
        sumEstSettlementAmount: typeof cotikProv?.sumEstSettlementAmount === "number" ? cotikProv.sumEstSettlementAmount : null,
        estimatedSettlement: typeof cotikProv?.estimatedSettlement === "string" ? cotikProv.estimatedSettlement : null,
        onHoldBuckets: (cotikProv?.onHoldBuckets as any) ?? null,
      } : null,
    };

    // Construct Audit Logs from real DB records
    const auditLogs: Array<{
      id: string;
      type: "DECISION_CASE" | "BA_SUBMISSION" | "SYNC_RUN" | "PROFILE_VERIFICATION";
      timestamp: string;
      actor: string;
      summary: string;
      payload: Record<string, unknown>;
    }> = [];

    // 1. BA decisions & Decision Cases
    for (const rev of decisionPage.items) {
      if (rev.ba) {
        auditLogs.push({
          id: rev.ba.id,
          type: "BA_SUBMISSION",
          timestamp: rev.ba.decidedAt.toISOString(),
          actor: rev.ba.actor || "BA Operator",
          summary: `Quyết định BA: ${rev.ba.decision} (Lý do: ${rev.ba.reasonCode})`,
          payload: {
            caseId: rev.case.id,
            decision: rev.ba.decision,
            reasonCode: rev.ba.reasonCode,
            reasonCodes: rev.ba.reasonCodes,
            notes: rev.ba.notes ?? rev.ba.note,
          },
        });
      }
      for (const historyItem of rev.baHistory) {
        if (historyItem.id !== rev.ba?.id) {
          auditLogs.push({
            id: historyItem.id,
            type: "BA_SUBMISSION",
            timestamp: historyItem.decidedAt.toISOString(),
            actor: historyItem.actor || "BA Operator",
            summary: `Quyết định BA (Lịch sử): ${historyItem.decision} (Lý do: ${historyItem.reasonCode})`,
            payload: {
              caseId: rev.case.id,
              decision: historyItem.decision,
              reasonCode: historyItem.reasonCode,
              reasonCodes: historyItem.reasonCodes,
              notes: historyItem.notes ?? historyItem.note,
            },
          });
        }
      }
      auditLogs.push({
        id: rev.case.id,
        type: "DECISION_CASE",
        timestamp: rev.case.observedAt.toISOString(),
        actor: "System Engine",
        summary: `Hồ sơ rủi ro: Khuyến nghị ${rev.rule.decision}, AI: ${rev.ai?.recommendation ?? "Chưa có"}`,
        payload: {
          ruleResult: rev.rule.decision,
          aiRecommendation: rev.ai?.recommendation,
          coverageState: rev.coverageSnapshot.coverageState,
          deliveryRate: rev.metrics.deliveryRate,
          totalOrders: rev.metrics.totalOrders,
        },
      });
    }

    // 2. Sync runs
    for (const run of syncRunsList) {
      auditLogs.push({
        id: run.id,
        type: "SYNC_RUN",
        timestamp: run.startedAt.toISOString(),
        actor: "Sync Worker / Operator",
        summary: `Đồng bộ ${run.mode}: ${run.status} (${run.rowsWritten} bản ghi ghi, ${run.rowsRead} bản ghi đọc)`,
        payload: {
          mode: run.mode,
          status: run.status,
          rowsRead: run.rowsRead,
          rowsWritten: run.rowsWritten,
          failureType: run.failureType,
          failureMessage: run.failureMessage,
          finishedAt: run.finishedAt?.toISOString() ?? null,
        },
      });
    }

    // 3. Profile verification
    if (dbProfile?.lastVerifiedAt) {
      auditLogs.push({
        id: `verify-${dbProfile.id}`,
        type: "PROFILE_VERIFICATION",
        timestamp: dbProfile.lastVerifiedAt.toISOString(),
        actor: "Profile Verifier",
        summary: `Xác thực Profile AdsPower: Trạng thái ${dbProfile.verificationState}, TikTok Shop: ${dbProfile.verifiedShopDisplayName || dbProfile.verifiedTiktokShopId || "Chưa liên kết"}`,
        payload: {
          verificationState: dbProfile.verificationState,
          eligibilityStatus: dbProfile.eligibilityStatus,
          verifiedTiktokShopId: dbProfile.verifiedTiktokShopId,
          verifiedShopDisplayName: dbProfile.verifiedShopDisplayName,
        },
      });
    }

    // Sort audit logs by timestamp desc
    auditLogs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    // BA revisions
    const baRevisions = latestReview?.baHistory.length
      ? latestReview.baHistory
      : (latestReview?.ba ? [latestReview.ba] : []);

    const detail: ConsoleShopDetail = {
      shop: shopSummary,
      overview: {
        orderHealth: presentation.orderHealth,
        finance: {
          onHoldAmount: onHoldAmount,
          currency: shop.currency,
          capturedAt: formatIso(financeSummary.latestSnapshot?.capturedAt),
          cotikOnHold: cotikBinding ? {
            sumEstSettlementAmount: typeof cotikProv?.sumEstSettlementAmount === "number" ? cotikProv.sumEstSettlementAmount : null,
            estimatedSettlement: typeof cotikProv?.estimatedSettlement === "string" ? cotikProv.estimatedSettlement : null,
            onHoldBuckets: (cotikProv?.onHoldBuckets as any) ?? null,
          } : null,
        },
        kpis: presentation.kpis.map((k) => {
          if (k.id === "on-hold" && (k.value === "Unavailable" || k.value === "$0.00") && onHoldAmount !== null) {
            const num = Number(onHoldAmount);
            const valStr = Number.isFinite(num)
              ? `$${num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
              : onHoldAmount;
            return {
              id: k.id,
              label: "Finance On Hold",
              value: valStr,
              detail: cotikProv?.estimatedSettlement ? `Estimated settlement: ${cotikProv.estimatedSettlement}` : "COTIK sum est settlement",
              tone: (num > 0 ? "warning" : "good") as "warning" | "good",
            };
          }
          return {
            id: k.id,
            label: k.label,
            value: k.value,
            detail: k.detail,
            tone: (k.tone === "danger" || k.tone === "rose") ? "danger" : (k.tone === "warning" || k.tone === "amber") ? "warning" : (k.tone === "mint" || k.tone === "success") ? "good" : "neutral",
          };
        }),
      },
      dataTab: {
        dataCoverage: computeCoverageState(latestReview),
        coverageReason: latestReview?.coverageSnapshot ? null : "Chưa có snapshot độ phủ dữ liệu",
        provenWindow: latestReview?.coverageSnapshot.provenSourceWindow ?? "ROLLING_12_MONTHS",
        sourceReconciled: latestReview?.coverageSnapshot.sourceReconciled ? "Đã đối chiếu" : "Chưa đối chiếu",
        freshness: latestReview?.coverageSnapshot.freshness ?? "Chưa rõ",
        lifetimeHistory: latestReview?.coverageSnapshot.lifetimeHistoryComplete ? "Đầy đủ lịch sử" : "Chưa hoàn tất toàn bộ lịch sử",
        ordersCount: totalOrders,
        financeCapturedAt: formatIso(financeSummary.latestSnapshot?.capturedAt),
        rawSummaryNote: "Dữ liệu được trích xuất từ Seller Center qua phiên AdsPower xác thực và lưu trữ bất biến trong PostgreSQL.",
      },
      tagsTab: {
        profileTags: liveAds?.tags ?? [],
        groupName: liveAds?.groupName ?? null,
        region: shop.region,
        locale: shop.locale,
        currency: shop.currency,
        dataNote: "Thẻ và phân nhóm được đồng bộ trực tiếp từ hồ sơ AdsPower hiện tại.",
      },
      syncTab: {
        syncRuns: syncRunsList.map((r) => ({
          id: r.id,
          mode: r.mode,
          status: r.status,
          startedAt: r.startedAt.toISOString(),
          finishedAt: r.finishedAt?.toISOString() ?? null,
          rowsRead: r.rowsRead,
          rowsWritten: r.rowsWritten,
          failureType: r.failureType,
          failureMessage: r.failureMessage,
        })),
        lastOrdersSyncedAt: formatIso(shop.lastOrdersSyncedAt),
        lastFinanceSyncedAt: formatIso(shop.lastFinanceSyncedAt),
        syncState: (shop.syncState as any) ?? "IDLE",
        pauseReason: shop.pauseReason,
      },
      statsTab: {
        metrics: presentation.decisionCenter?.metrics ?? [],
        comparisons: presentation.decisionCenter?.comparisons ?? [],
        trends: presentation.decisionCenter?.trends ?? [],
      },
      baTab: {
        activeCaseId: latestReview?.case.id ?? null,
        currentDecision: latestReview?.ba?.decision ?? "CHƯA_ĐÁNH_GIÁ",
        currentDetail: latestReview?.ba ? `Quyết định bởi ${latestReview.ba.actor}` : "Chưa có quyết định BA nào cho ca này.",
        ruleResult: latestReview?.rule.decision ?? "CHƯA_XÁC_ĐỊNH",
        aiRecommendation: latestReview?.ai?.recommendation ?? "KHÔNG_KHẢ_DỤNG",
        aiConfidence: latestReview?.ai?.confidence ? String(latestReview.ai.confidence) : "Không xác định",
        aiRiskLevel: latestReview?.ai?.riskLevel ?? "Không xác định",
        aiSummary: latestReview?.ai?.reason ?? "Chưa có phân tích AI",
        aiReasonCodes: latestReview?.ai?.reasonCodes ?? [],
        history: baRevisions.map((rev) => ({
          id: rev.id,
          decision: rev.decision,
          reasonCode: rev.reasonCode,
          reasonCodes: rev.reasonCodes,
          actor: rev.actor,
          notes: rev.notes ?? rev.note,
          decidedAt: rev.decidedAt.toISOString(),
        })),
      },
      auditTab: {
        auditLogs,
        schemaNotice: "Nhật ký kiểm toán truy vấn từ các bảng bất biến: decision_cases, ba_decisions, sync_runs, adspower_profiles.",
      },
      decisionCenter: presentation.decisionCenter ?? (null as any),
    };

    return detail;
  } finally {
    await closeDatabase(context);
  }
}
