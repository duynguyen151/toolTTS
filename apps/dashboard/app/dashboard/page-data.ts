import type { DashboardPresentation } from "../../lib/dashboard-contract";
import type { ProfileOperationsPresentation } from "../../lib/operations-contract";

const DEMO_OPERATIONS_PRESENTATION: ProfileOperationsPresentation = {
  status: "READY",
  selectedProfileNo: null,
  profiles: [],
  error: null,
};

export function normalizeRequestedShopProfileNo(
  queryValue: string | readonly string[] | undefined,
): string | undefined {
  const value = Array.isArray(queryValue) ? queryValue[0] : queryValue;
  return value === undefined ? undefined : value.trim();
}

export function shouldBindPersistedShop(
  renderedShopProfileNo: string,
  requestedProfileNo: string | undefined,
): boolean {
  return requestedProfileNo === undefined || requestedProfileNo === renderedShopProfileNo;
}

export async function loadProfileOperationsPresentation(
  presentation: Pick<DashboardPresentation, "dataOrigin">,
  listProfiles: () => Promise<ProfileOperationsPresentation>,
): Promise<ProfileOperationsPresentation> {
  if (presentation.dataOrigin === "DEMO_SANITIZED") return DEMO_OPERATIONS_PRESENTATION;
  return listProfiles();
}
