import AdminDashboard from "@/components/dashboard/AdminDashboard";
import { getAdminDashboardData, getDashboardWidgetsForActor } from "@/lib/adminDashboard";
import { visibleDashboardWidgetIds } from "@/lib/dashboardWidgets";
import { parsePreset } from "@/lib/dashboardDateRange";
import {
  resolveDashboardOperationalClinicId,
  resolveSelectedClinicId,
} from "@/lib/selectedClinic";
import { requireActor } from "@/lib/session";
import { getDashboardCallHandlingForActor } from "@/lib/telephony/dashboardCallHandling";
import { getBookingFollowUpsForActor } from "@/lib/telephony/bookingFollowUps";

/**
 * One permission-driven dashboard path for every tenant user, including the
 * wildcard owner. Permissions decide which widgets appear; the Doctor role key
 * only selects the fixed "My Day" order (see lib/dashboardWidgetOrder.ts).
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
  const widgets = await getDashboardWidgetsForActor(actor);
  const [data, callHandling, bookingFollowUps] = await Promise.all([
    getAdminDashboardData(
      actor,
      selectedClinicId,
      period,
      now,
      visibleDashboardWidgetIds(widgets),
    ),
    operationalClinicId === null
      ? Promise.resolve(null)
      : getDashboardCallHandlingForActor(actor, operationalClinicId, now),
    getBookingFollowUpsForActor(actor, selectedClinicId),
  ]);

  return (
    <AdminDashboard
      data={data}
      widgets={widgets}
      callHandling={callHandling}
      bookingFollowUps={bookingFollowUps}
      now={now}
    />
  );
}
