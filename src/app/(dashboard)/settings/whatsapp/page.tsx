import { redirect } from "next/navigation";
import WhatsappProviderSettings from "@/components/settings/WhatsappProviderSettings";
import ModuleLocked from "@/components/ui/ModuleLocked";
import PageHeader from "@/components/ui/PageHeader";
import { MODULE_FEATURES, moduleLock } from "@/lib/features";
import { can } from "@/lib/rbac";
import { requireActor, UnauthenticatedError } from "@/lib/session";
import { getWhatsappConfigurationForActor } from "@/lib/whatsappProviderConfig";

export default async function WhatsappSettingsPage() {
  let actor;
  try {
    actor = await requireActor();
  } catch (error: unknown) {
    if (error instanceof UnauthenticatedError) redirect("/login");
    throw error;
  }

  const locked = await moduleLock(actor, MODULE_FEATURES.whatsapp);
  if (locked) return <ModuleLocked title="WhatsApp provider" reason={locked} />;

  const [configuration, canEdit] = await Promise.all([
    getWhatsappConfigurationForActor(actor),
    can(actor, "settings:manage"),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="WhatsApp provider"
        description="Connect your organisation's RkvRobo account and route each clinic through a specific WhatsApp device."
        breadcrumbs={[
          { label: "Settings", href: "/settings" },
          { label: "WhatsApp provider" },
        ]}
      />
      <WhatsappProviderSettings initialValue={configuration} canEdit={canEdit} />
    </div>
  );
}
