import type { DashboardPresentation } from "../../lib/dashboard-contract";
import type { ProfileOperationsPresentation } from "../../lib/operations-contract";

const DEMO_OPERATIONS_PRESENTATION: ProfileOperationsPresentation = {
  status: "READY",
  selectedProfileNo: null,
  profiles: [],
  error: null,
};

export async function loadProfileOperationsPresentation(
  presentation: Pick<DashboardPresentation, "dataOrigin">,
  listProfiles: () => Promise<ProfileOperationsPresentation>,
): Promise<ProfileOperationsPresentation> {
  if (presentation.dataOrigin === "DEMO_SANITIZED") return DEMO_OPERATIONS_PRESENTATION;
  return listProfiles();
}
