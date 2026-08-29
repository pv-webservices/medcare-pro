import { redirect } from "next/navigation";
import DashboardSettingsClient from "@/components/settings/DashboardSettingsClient";
import PageHeader from "@/components/ui/PageHeader";
import { getEffectiveDashboardLayout, getManageableDashboardRoles } from "@/lib/dashboardLayouts";
import { can, holdsAnywhere, permissionsHeldAnywhere } from "@/lib/rbac";
import { requireActor, UnauthenticatedError } from "@/lib/session";

export default async function DashboardSettingsPage() {
  let actor;
  try {
    actor = await requireActor();
  } catch (error: unknown) {
    if (error instanceof UnauthenticatedError) redirect("/login");
    throw error;
  }

  const [held, canManage] = await Promise.all([
    permissionsHeldAnywhere(actor),
    can(actor, "dashboard:layout:manage"),
  ]);
  const canView = holdsAnywhere(held, "dashboard:view");
  const canCustomize = holdsAnywhere(held, "dashboard:customize");
  if (!canView && !canCustomize && !canManage) redirect("/settings");

  const [effective, roles] = await Promise.all([
    getEffectiveDashboardLayout(actor),
    canManage ? getManageableDashboardRoles(actor) : Promise.resolve([]),
  ]);

  return (
    <section className="space-y-5">
      <PageHeader title="Dashboard settings" description="Choose the order, visibility, and supported sizes of authorized dashboard widgets." />
      <DashboardSettingsClient
        personalLayout={effective.layout}
        personalSource={effective.source === "personal" ? "your saved layout" : effective.source === "role" ? "your role default" : "system default"}
        canCustomize={canCustomize}
        roles={roles}
      />
    </section>
  );
}
