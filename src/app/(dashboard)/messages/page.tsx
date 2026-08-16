import { redirect } from "next/navigation";
import MessageComposer from "@/components/messages/MessageComposer";
import MessageHistory from "@/components/messages/MessageHistory";
import TemplateManager from "@/components/messages/TemplateManager";
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
      <section>
        <h1 className="mb-4 text-2xl font-semibold">Messages</h1>
        <p className="rounded border border-black/15 px-4 py-3 text-sm text-black/60 dark:border-white/20 dark:text-white/60">
          Your role cannot send WhatsApp messages. Ask an admin or the account
          owner if you need access.
        </p>
      </section>
    );
  }

  const configured = isWhatsappConfigured();

  const [clinics, selectedClinicId, canManageTemplates] = await Promise.all([
    listClinicsForActor(actor),
    resolveSelectedClinicId(actor),
    can(actor, "message:template"),
  ]);

  // Asked of the gateway only when there is something to ask about. Null means
  // "could not tell" — the device is rotating, or the check itself failed —
  // which is reported as unknown rather than as a problem.
  let device: DeviceStatus | null = null;
  if (configured) {
    device = await getDeviceStatus().catch(() => null);
  }

  // The sidebar switcher only renders when there is more than one clinic, so a
  // single-clinic account has nothing to select and is resolved directly.
  const clinicId = selectedClinicId ?? (clinics.length === 1 ? clinics[0].id : null);
  const clinicName = clinics.find((clinic) => clinic.id === clinicId)?.name ?? null;

  return (
    <section>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Messages</h1>
        <p className="mt-1 text-sm text-black/60 dark:text-white/60">
          Send an approved template to patients on WhatsApp.
        </p>
      </div>

      {device && !device.connected && (
        <p
          role="alert"
          className="mb-6 rounded border border-amber-600/40 bg-amber-600/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-400"
        >
          The WhatsApp device is {device.status.toLowerCase()}. Scan its QR code
          in the provider panel to reconnect — sends will fail until you do.
        </p>
      )}

      <section aria-labelledby="send-heading" className="mb-8">
        <h2 id="send-heading" className="mb-3 text-lg font-semibold">
          Send a message
        </h2>
        {templates.length === 0 ? (
          <p className="rounded border border-black/15 px-4 py-6 text-center text-sm text-black/60 dark:border-white/20 dark:text-white/60">
            {canManageTemplates
              ? "Add a template below before you can message patients."
              : "No templates yet. Ask an admin to add one before you can message patients."}
          </p>
        ) : (
          <MessageComposer
            templates={templates}
            clinicId={clinicId}
            clinicName={clinicName}
            isConfigured={configured}
          />
        )}
      </section>

      <div className="mb-8">
        <TemplateManager templates={templates} canManage={canManageTemplates} />
      </div>

      <section aria-labelledby="history-heading">
        <h2 id="history-heading" className="mb-3 text-lg font-semibold">
          Message history
        </h2>
        <MessageHistory messages={messages} />
      </section>
    </section>
  );
}
