import { MessageSquare } from "lucide-react";
import { redirect } from "next/navigation";
import MessageComposer from "@/components/messages/MessageComposer";
import MessageHistory from "@/components/messages/MessageHistory";
import TemplateManager from "@/components/messages/TemplateManager";
import EmptyState from "@/components/ui/EmptyState";
import PageHeader from "@/components/ui/PageHeader";
import { listClinicsForActor } from "@/lib/clinics";
import { can, PermissionError } from "@/lib/rbac";
import { resolveSelectedClinicId } from "@/lib/selectedClinic";
import { requireActor, UnauthenticatedError } from "@/lib/session";
import {
  getDeviceStatus,
  isWhatsappConfigured,
  type DeviceStatus,
} from "@/lib/whatsapp";
import {
  listMessagesForActor,
  type MessageRecord,
} from "@/lib/whatsappMessages";
import {
  listTemplatesForActor,
  type TemplateRecord,
} from "@/lib/whatsappTemplates";
import ModuleLocked from "@/components/ui/ModuleLocked";
import { MODULE_FEATURES, moduleLock } from "@/lib/features";

// WhatsApp — PRD §6.9 (FR-9.1, FR-9.2).
//
// Provider: RkvRobo, a gateway driving real WhatsApp devices rather than an
// official BSP. It has no template approval and no delivery-status callback,
// which is why the approved set is stored in this app and why the history
// below says "Accepted" rather than showing a delivery tick.
//
// `message:send` is enforced in @/lib/whatsappMessages, not by hiding this
// page: reaching this URL directly gets the same refusal the API gives. The
// clinic comes from the sidebar switcher, as in every other module (FR-2.3).

export default async function MessagesPage() {
  let actor;
  try {
    actor = await requireActor();
  } catch (error: unknown) {
    if (error instanceof UnauthenticatedError) {
      redirect("/login");
    }
    throw error;
  }

  const locked = await moduleLock(actor, MODULE_FEATURES.whatsapp);
  if (locked) {
    return <ModuleLocked title="Messages" reason={locked} />;
  }

  const [clinics, selectedClinicId, canManageTemplates] = await Promise.all([
    listClinicsForActor(actor),
    resolveSelectedClinicId(actor),
    can(actor, "message:template"),
  ]);

  // The sidebar switcher only renders when there is more than one clinic, so a
  // single-clinic account has nothing to select and is resolved directly.
  const clinicId = selectedClinicId ?? (clinics.length === 1 ? clinics[0].id : null);
  const clinicName = clinics.find((clinic) => clinic.id === clinicId)?.name ?? null;

  let templates: TemplateRecord[] | null = null;
  let messages: MessageRecord[] = [];
  try {
    [templates, messages] = await Promise.all([
      listTemplatesForActor(actor, clinicId),
      listMessagesForActor(actor, { clinicId: clinicId ?? undefined }),
    ]);
  } catch (error: unknown) {
    if (!(error instanceof PermissionError)) {
      throw error;
    }
  }

  if (!templates) {
    return (
      <section className="space-y-4">
        <PageHeader title="Messages" />
        <div className="rounded-2xl border border-line bg-canvas-deep px-5 py-4 text-body text-muted">
          Your role cannot send WhatsApp messages. Ask an admin or the account
          owner if you need access.
        </div>
      </section>
    );
  }

  const configured = isWhatsappConfigured();

  // Asked of the gateway only when there is something to ask about. A probe
  // that cannot answer — rotating sender, gateway down — is left as null and
  // reported as nothing rather than as a fault.
  let device: DeviceStatus | null = null;
  if (configured) {
    const probe = await getDeviceStatus().catch(() => null);
    device = probe?.ok ? probe.device : null;
  }

  return (
    <section className="space-y-5">
      <PageHeader
        title="Messages"
        description="Send approved WhatsApp templates to patients. Free-text messages are not supported by the provider."
        scope={clinicName ?? "All clinics"}
      />

      {device && !device.connected && (
        <p
          role="alert"
          className="rounded-2xl border border-warn-line bg-warn-bg px-4 py-3 text-body text-warn-ink"
        >
          The WhatsApp device is {device.status.toLowerCase()}. Scan its QR code
          in the provider panel to reconnect — sends will fail until you do.
        </p>
      )}

      {templates.length === 0 ? (
        <EmptyState
          icon={<MessageSquare className="h-5 w-5" strokeWidth={2} />}
          title="No approved templates yet"
          guidance={
            canManageTemplates
              ? "Add a template below before you can message patients."
              : "Ask an admin to add one before you can message patients."
          }
        />
      ) : (
        <MessageComposer
          templates={templates}
          clinicId={clinicId}
          clinicName={clinicName}
          isConfigured={configured}
        />
      )}

      <div className="pt-2">
        <TemplateManager
          templates={templates}
          canManage={canManageTemplates}
          clinicId={clinicId}
          clinicName={clinicName}
        />
      </div>

      <section aria-labelledby="history-heading" className="space-y-4 pt-2">
        <h2 id="history-heading" className="text-lg font-bold tracking-tight text-ink">
          Message history
        </h2>
        <MessageHistory messages={messages} />
      </section>
    </section>
  );
}
