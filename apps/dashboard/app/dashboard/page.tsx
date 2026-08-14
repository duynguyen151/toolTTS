import { DashboardOverview } from "../../components/dashboard/dashboard-overview";
import { loadDashboardPresentation } from "../../lib/dashboard-read";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const presentation = await loadDashboardPresentation();

  return <DashboardOverview presentation={presentation} />;
}
