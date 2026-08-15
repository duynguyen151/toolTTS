import {
  closeDatabase,
  createDatabase,
  findShopByProfileNo,
  listShops,
  type DatabaseContext,
} from "@shop-health/db";
import type { SellerDataSource } from "@shop-health/domain";
import {
  AdsPowerClient,
  type AdsPowerBrowserConnection,
} from "@shop-health/seller-center/adspower";
import {
  createAdsPowerApplicationLauncher,
  type AdsPowerApplicationLauncher,
} from "./application-launch.js";

import {
  createDashboardOperations,
  type DashboardOperations,
  type DashboardOperationsAdapters,
} from "./dashboard-operations.js";

export interface DashboardOperationsRuntimeOptions {
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly adsPower?: AdsPowerClient;
  readonly applicationLauncher?: AdsPowerApplicationLauncher;
  readonly source?: SellerDataSource;
  readonly verifyCdpConnection?: (connection: AdsPowerBrowserConnection) => Promise<void>;
}

async function withDatabase<T>(
  databaseUrl: string | undefined,
  operation: (context: DatabaseContext) => Promise<T>,
): Promise<T> {
  if (databaseUrl === undefined || databaseUrl.trim().length === 0) {
    throw new Error("DATABASE_URL is required for dashboard operations");
  }

  const context = createDatabase(databaseUrl);
  try {
    return await operation(context);
  } finally {
    await closeDatabase(context);
  }
}

export function createDashboardOperationsRuntime(
  options: DashboardOperationsRuntimeOptions = {},
): DashboardOperations {
  const environment = options.environment ?? process.env;
  const defaultAdsPower = new AdsPowerClient({
    ...(environment.ADSPOWER_BASE_URL === undefined ? {} : { baseUrl: environment.ADSPOWER_BASE_URL }),
    ...(environment.ADSPOWER_API_KEY === undefined ? {} : { apiKey: environment.ADSPOWER_API_KEY }),
  });
  const adsPower = options.adsPower ?? defaultAdsPower;
  const applicationLauncher = options.applicationLauncher ?? createAdsPowerApplicationLauncher({
    probeReadiness: () => adsPower.probeReadiness(),
    ...(environment.ADSPOWER_EXECUTABLE_PATH === undefined
      ? {}
      : { executablePath: environment.ADSPOWER_EXECUTABLE_PATH }),
    environment,
  });
  const databaseUrl = environment.DATABASE_URL;
  let source: SellerDataSource | undefined = options.source;

  const verifyCdpConnection = options.verifyCdpConnection ?? (async (connection) => {
    const { verifyAdsPowerBrowserConnection } = await import("@shop-health/seller-center/browser-source");
    await verifyAdsPowerBrowserConnection(connection);
  });

  async function getSource(): Promise<SellerDataSource> {
    if (source !== undefined) return source;
    const { createSellerCenterDataSource } = await import("@shop-health/seller-center/browser-source");
    source = createSellerCenterDataSource({ adsPowerClient: adsPower });
    return source;
  }

  const adapters: DashboardOperationsAdapters = {
    listAdsPowerProfiles: () => adsPower.listProfiles(),
    listShops: () => withDatabase(databaseUrl, async ({ db }) => (
      (await listShops(db)).map((shop) => ({
        id: shop.id,
        profileId: shop.profileId,
        profileNo: shop.profileNo,
        displayName: shop.displayName ?? shop.profileNo,
      }))
    )),
    ensureAdsPowerReady: () => applicationLauncher.ensureReady(),
    openReady: async (profileId) => {
      const connection = await adsPower.openReady(profileId);
      await verifyCdpConnection(connection);
    },
    checkSellerCenterHealth: async (shop) => {
      const sellerCenterSource = await getSource();
      return sellerCenterSource.health({
        shopId: shop.id,
        profileId: shop.profileId,
        profileNo: shop.profileNo,
        region: "US",
        locale: "en-US",
      });
    },
    runSync: (profileNo, kind) => withDatabase(databaseUrl, async (context) => {
      const shop = await findShopByProfileNo(context.db, profileNo);
      if (shop === null) throw new Error("Linked shop was not found");
      const [{ runShopSync }, sellerCenterSource] = await Promise.all([
        import("@shop-health/sync"),
        getSource(),
      ]);
      const result = await runShopSync({ context, source: sellerCenterSource, shop, kind });
      return {
        status: result.status,
        complete: result.complete,
        ...(result.sourceCoverage === undefined ? {} : { sourceCoverage: result.sourceCoverage }),
        ...(result.financeProof === undefined ? {} : { financeProof: result.financeProof }),
      };
    }),
    evaluateRisk: (profileNo) => withDatabase(databaseUrl, async (context) => {
      const shop = await findShopByProfileNo(context.db, profileNo);
      if (shop === null) throw new Error("Linked shop was not found");
      const [
        { createBaselineAiClientFromConfig, readBaselineAiConfig },
        { createPersistedDecisionWorkflow },
        { evaluateAndStoreRiskControl },
      ] = await Promise.all([
        import("@shop-health/decision-ai"),
        import("@shop-health/decision-workflow"),
        import("@shop-health/sync"),
      ]);
      await evaluateAndStoreRiskControl(context, shop);
      const workflow = createPersistedDecisionWorkflow({
        context,
        aiClient: createBaselineAiClientFromConfig(readBaselineAiConfig(environment as NodeJS.ProcessEnv)),
      });
      const review = await workflow.startReview({ profileNo });
      return review.coverageSnapshot;
    }),
  };

  return createDashboardOperations(adapters);
}

let dashboardOperations: DashboardOperations | undefined;

export function getDashboardOperations(): DashboardOperations {
  dashboardOperations ??= createDashboardOperationsRuntime();
  return dashboardOperations;
}
