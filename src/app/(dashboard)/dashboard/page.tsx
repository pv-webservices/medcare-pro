import AdminDashboard from "@/components/dashboard/AdminDashboard";
import { getAdminDashboardData } from "@/lib/adminDashboard";
import { getEffectiveDashboardLayout } from "@/lib/dashboardLayouts";
import { visibleDashboardWidgetIds } from "@/lib/dashboardWidgets";
import { parsePreset } from "@/lib/dashboardDateRange";
import { resolveSelectedClinicId } from "@/lib/selectedClinic";
import { requireActor } from "@/lib/session";

/**
 * One permission-driven dashboard path for every tenant user, including the
 * wildcard owner. Role names and role keys never select a dashboard variant.
 */
export default async function DashboardPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await props.searchParams;
  const actor = await requireActor();
  const selectedClinicId = await resolveSelectedClinicId(actor);
  const period = parsePreset(typeof params.range === "string" ? params.range : undefined);
  const now = new Date();
  const layout = await getEffectiveDashboardLayout(actor);
  const data = await getAdminDashboardData(
    actor,
    selectedClinicId,
    period,
    now,
    visibleDashboardWidgetIds(layout.layout),
  );

  return <AdminDashboard data={data} layout={layout} now={now} />;
}
