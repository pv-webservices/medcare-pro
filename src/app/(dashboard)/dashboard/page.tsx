import AdminDashboard from "@/components/dashboard/AdminDashboard";
import { getAdminDashboardData } from "@/lib/adminDashboard";
import { getEffectiveDashboardLayout } from "@/lib/dashboardLayouts";
import { visibleDashboardWidgetIds } from "@/lib/dashboardWidgets";
import { parsePreset } from "@/lib/dashboardDateRange";
import {
  resolveDashboardOperationalClinicId,
  resolveSelectedClinicId,
} from "@/lib/selectedClinic";
import { requireActor } from "@/lib/session";
import { getDashboardCallHandlingForActor } from "@/lib/telephony/dashboardCallHandling";

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
  const operationalClinicId = await resolveDashboardOperationalClinicId(
    actor,
    selectedClinicId,
  );
  const period = parsePreset(typeof params.range === "string" ? params.range : undefined);
  const now = new Date();
  const layout = await getEffectiveDashboardLayout(actor);
  const [data, callHandling] = await Promise.all([
    getAdminDashboardData(
      actor,
      selectedClinicId,
      period,
      now,
      visibleDashboardWidgetIds(layout.layout),
    ),
    operationalClinicId === null
      ? Promise.resolve(null)
      : getDashboardCallHandlingForActor(actor, operationalClinicId, now),
  ]);

  return (
    <AdminDashboard
      data={data}
      layout={layout}
      callHandling={callHandling}
      now={now}
    />
  );
}
