import { jsonOk, readJsonBody, toErrorResponse } from "@/lib/apiHandler";
import { requireActor } from "@/lib/session";
import { sendMessageSchema, sendToPatients } from "@/lib/whatsappMessages";

// WhatsApp send — PRD §6.9 (FR-9.1, FR-9.2).
//
// Takes a template id and a list of PATIENT IDS — never a phone number and
// never a message body. Both matter:
//
//   - Numbers are read from the patient record server-side, so this endpoint
//     cannot be used to message an arbitrary phone through the account's
//     WhatsApp device, and every send is attributable to a real patient.
//   - The body comes from a WhatsappTemplate row (FR-9.1). RkvRobo is not an
//     official BSP and has no template approval of its own, so the approved
//     set is ours — see @/lib/whatsappTemplates.
//
// Scoping and RBAC live in @/lib/whatsappMessages: `message:send` is required,
// and each patient is re-checked against the caller's clinic reach before a
// message goes anywhere.

export async function POST(request: Request) {
  try {
    const actor = await requireActor();
    const input = sendMessageSchema.parse(await readJsonBody(request));

    // Answers 200 even when some recipients failed: a partial send is a real
    // outcome the caller must see per recipient, not an error that hides which
    // eleven of twelve went out. The per-row status carries the detail.
    return jsonOk(await sendToPatients(actor, input));
  } catch (error: unknown) {
    return toErrorResponse(error, "POST /api/whatsapp/send");
  }
}
