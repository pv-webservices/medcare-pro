import { redirect } from "next/navigation";
import MessageComposer from "@/components/messages/MessageComposer";
import MessageHistory from "@/components/messages/MessageHistory";
import TemplateManager from "@/components/messages/TemplateManager";
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

  let templates: TemplateRecord[] | null = null;
  let messages: MessageRecord[] = [];
  try {
    [templates, messages] = await Promise.all([
      listTemplatesForActor(actor),
      listMessagesForActor(actor),
    ]);
  } catch (error: unknown) {
    if (!(error instanceof PermissionError)) {
      throw error;
    }
  }

  if (!templates) {
    return (
      <section className="max-w-[1400px] mx-auto w-full animate-in fade-in duration-500 space-y-6">
        <PageHeader title="Messages" />
        <div className="rounded-xl bg-canvas-deep px-5 py-4 text-sm font-medium text-muted">
          Your role cannot send WhatsApp messages. Ask an admin or the account
          owner if you need access.
        </div>
      </section>
    );
  }

  const configured = isWhatsappConfigured();

  const [clinics, selectedClinicId, canManageTemplates] = await Promise.all([
    listClinicsForActor(actor),
    resolveSelectedClinicId(actor),
    can(actor, "message:template"),
  ]);

  // Asked of the gateway only when there is something to ask about. A probe
  // that cannot answer — rotating sender, gateway down — is left as null and
  // reported as nothing rather than as a fault.
  let device: DeviceStatus | null = null;
  if (configured) {
    const probe = await getDeviceStatus().catch(() => null);
    device = probe?.ok ? probe.device : null;
  }

  // The sidebar switcher only renders when there is more than one clinic, so a
  // single-clinic account has nothing to select and is resolved directly.
  const clinicId = selectedClinicId ?? (clinics.length === 1 ? clinics[0].id : null);
  const clinicName = clinics.find((clinic) => clinic.id === clinicId)?.name ?? null;

  return (
    <section className="max-w-[1400px] mx-auto w-full animate-in fade-in duration-500 space-y-8">
      <PageHeader
        title="Messages"
        meta="Send an approved template to patients on WhatsApp."
      />

      {device && !device.connected && (
        <p
          role="alert"
          className="rounded-xl bg-warn-bg px-4 py-3 text-sm text-warn-ink font-medium"
        >
          The WhatsApp device is {device.status.toLowerCase()}. Scan its QR code
          in the provider panel to reconnect — sends will fail until you do.
        </p>
      )}

      <section aria-labelledby="send-heading" className="space-y-4">
        <h2 id="send-heading" className="text-lg font-bold text-ink">
          Send a message
        </h2>
        {templates.length === 0 ? (
          <div className="rounded-2xl bg-canvas px-6 py-8 text-center shadow-neu-raised-sm">
            <p className="text-sm font-medium text-muted">
              {canManageTemplates
                ? "Add a template below before you can message patients."
                : "No templates yet. Ask an admin to add one before you can message patients."}
            </p>
          </div>
        ) : (
          <MessageComposer
            templates={templates}
            clinicId={clinicId}
            clinicName={clinicName}
            isConfigured={configured}
          />
        )}
      </section>

      <div className="pt-2">
        <TemplateManager templates={templates} canManage={canManageTemplates} />
      </div>

      <section aria-labelledby="history-heading" className="space-y-4 pt-2">
        <h2 id="history-heading" className="text-lg font-bold text-ink">
          Message history
        </h2>
        <MessageHistory messages={messages} />
      </section>
    </section>
  );
}
