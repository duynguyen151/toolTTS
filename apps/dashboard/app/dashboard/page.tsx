import { DashboardOverview } from "../../components/dashboard/dashboard-overview";
import { OperationsProvider } from "../../components/operations/operations-provider";
import { loadDashboardPresentation } from "../../lib/dashboard-read";
import { getDashboardOperations } from "../../lib/server/operations/runtime";
import {
  loadProfileOperationsPresentation,
  normalizeRequestedShopProfileNo,
  shouldBindPersistedShop,
} from "./page-data";

export const dynamic = "force-dynamic";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ shop?: string | string[] | undefined; profile?: string | string[] | undefined }>;
}) {
  const query = await searchParams;
  const requestedShopProfileNo = normalizeRequestedShopProfileNo(query.shop);
  const requestedProfileNo = normalizeRequestedShopProfileNo(query.profile) ?? requestedShopProfileNo;
  const presentation = await loadDashboardPresentation(requestedShopProfileNo);
  const operations = await loadProfileOperationsPresentation(
    presentation,
    () => getDashboardOperations().listProfiles(presentation.selectedShop.profileNo),
  );
  return (
    <OperationsProvider
      key={requestedProfileNo ?? presentation.selectedShop.profileNo}
      initialPresentation={operations}
      preferredProfileNo={requestedProfileNo ?? presentation.selectedShop.profileNo}
      {...(shouldBindPersistedShop(presentation.selectedShop.profileNo, requestedProfileNo) ? {
        persistedShop: {
          profileNo: presentation.selectedShop.profileNo,
          displayName: presentation.selectedShop.displayName,
          dataOrigin: presentation.dataOrigin,
        },
      } : {})}
    >
      <DashboardOverview
        presentation={presentation}
        {...(requestedProfileNo === undefined ? {} : { operatorProfileNo: requestedProfileNo })}
      />
    </OperationsProvider>
  );
}
