import { DashboardOverview } from "../../components/dashboard/dashboard-overview";
import { OperationsProvider } from "../../components/operations/operations-provider";
import { loadDashboardPresentation } from "../../lib/dashboard-read";
import { getDashboardOperations } from "../../lib/server/operations/runtime";
import { loadProfileOperationsPresentation } from "./page-data";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const presentation = await loadDashboardPresentation();
  const operationsPresentation = await loadProfileOperationsPresentation(
    presentation,
    () => getDashboardOperations().listProfiles(),
  );

  return (
    <OperationsProvider
      initialPresentation={operationsPresentation}
      preferredProfileNo={presentation.selectedShop.profileNo}
      persistedShop={{
        profileNo: presentation.selectedShop.profileNo,
        displayName: presentation.selectedShop.displayName,
        dataOrigin: presentation.dataOrigin,
      }}
    >
      <DashboardOverview presentation={presentation} />
    </OperationsProvider>
  );
}
