export interface CotikAccountConfig {
  key: string;
  tokenKey: string;
  name: string;
  shortName: string;
  owner: string;
}

export const KNOWN_COTIK_ACCOUNTS: CotikAccountConfig[] = [
  { key: "tuan", tokenKey: "COTIK_TOKEN_TUAN", name: "Tuấn", shortName: "Tuấn", owner: "Tuấn" },
  { key: "hang", tokenKey: "COTIK_TOKEN_HANG", name: "Hằng", shortName: "Hằng", owner: "Hằng" },
  { key: "viet", tokenKey: "COTIK_TOKEN_VIET", name: "Việt", shortName: "Việt", owner: "Việt" },
  { key: "chuc", tokenKey: "COTIK_TOKEN_CHUC", name: "Chúc", shortName: "Chúc", owner: "Chúc" },
  { key: "lan", tokenKey: "COTIK_TOKEN_LAN", name: "Lan", shortName: "Lan", owner: "Lan" },
];

export interface CotikShopSummary {
  id: string;
  profileNo: string;
  displayName: string;
  tiktokShopId: string | null;
  accountKey: string;
  accountName: string;
  tokenKey: string;
  onHoldUSD: number;
  totalOrders: number;
  inTransitOrders: number;
  deliveredOrders: number;
  completedOrders: number;
  refundOrders: number;
  cancelledOrders: number;
  awaitingTrackingOrders: number;
  deliveryRate: string;
  lastSyncedAt: string | null;
}

export interface CotikAccountSummary {
  key: string;
  tokenKey: string;
  name: string;
  shortName: string;
  owner: string;
  isConfigured: boolean;
  maskedToken: string;
  shopCount: number;
  totalOnHoldUSD: number;
  totalOrders: number;
  inTransitOrders: number;
  deliveredOrders: number;
  completedOrders: number;
  refundOrders: number;
  cancelledOrders: number;
  awaitingTrackingOrders: number;
  deliveryRate: string;
  shops: CotikShopSummary[];
}

export interface CotikPortfolioMetrics {
  totalAccounts: number;
  totalShops: number;
  totalOnHoldUSD: number;
  totalOrders: number;
  inTransitOrders: number;
  deliveredOrders: number;
  completedOrders: number;
  refundOrders: number;
  cancelledOrders: number;
  awaitingTrackingOrders: number;
  overallDeliveryRate: string;
  accounts: CotikAccountSummary[];
  allShops: CotikShopSummary[];
}

export function maskToken(token?: string): string {
  if (!token) return "Chưa cấu hình";
  const trimmed = token.trim();
  if (trimmed.length <= 8) return "••••••••";
  return `${trimmed.slice(0, 4)}••••${trimmed.slice(-4)}`;
}
