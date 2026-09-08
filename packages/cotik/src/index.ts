export {
  createCotikClient,
  CotikClientError,
  type CotikClient,
  type CotikClientErrorCode,
  type CotikClientOptions,
} from "./client.js";

export {
  buildCotikPaymentListPath,
  buildCotikStatementListPath,
  COTIK_SUPPLEMENTARY_FINANCE_SCHEMA_VERSION,
  CotikSupplementaryFinanceIngestionError,
  ingestCotikSupplementaryFinance,
  normalizeCotikPayment,
  normalizeCotikStatement,
  type CotikSupplementaryFinanceIngestionErrorCode,
  type CotikSupplementaryFinanceIngestionInput,
  type CotikSupplementaryFinanceIngestionResult,
  type CotikSupplementaryFinancePathInput,
} from "./supplementary-finance.js";

export {
  buildCotikOrderListPath,
  COTIK_ORDERS_CHECKPOINT_SCHEMA_VERSION,
  CotikOrderIngestionError,
  INCREMENTAL_OVERLAP_MS,
  ingestCotikOrders,
  type CotikOrderIngestionErrorCode,
  type CotikOrderIngestionInput,
  type CotikOrderIngestionMode,
  type CotikOrderIngestionResult,
  type CotikOrdersBinding,
  type CotikOrdersCheckpoint,
} from "./order-ingestion.js";

// --- W21-T02 Multi-Account Cotik Client, Discovery, and Orders exports ---
export {
  createMultiAccountCotikClient,
  classifyCotikAccountHealth,
  type MultiAccountClientOptions,
  type MultiAccountCotikClient,
} from "./multi-account-client.js";

export {
  discoverAccountShops,
  normalizeShopRegion,
  deriveMaShopNoiBo,
  type DiscoveredCotikShop,
  type ShopDiscoveryResult,
  type DiscoveryResultState,
} from "./discovery.js";

export {
  fetchCotikOrdersPage,
  epochSecondsToDate,
  parseCotikOrderItems,
  normalizeRawToObservation,
  type FetchCotikOrdersFilter,
} from "./multi-account-orders.js";

// --- W21-T03 POST Tracking Writer exports ---
export {
  postCotikTrackingBatch,
  checkOrderTrackingReady,
  confirmOrderTrackingReadback,
  MAX_TRACKING_BATCH_SIZE,
  type CotikTrackingItem,
  type PostCotikTrackingBatchInput,
  type PostCotikTrackingResult
} from "./tracking-writer.js";
