import { notImplemented } from "@/lib/utils";

// WhatsApp send — PRD §6.9 (FR-9.1, FR-9.2).
// TODO(WhatsApp stage): call sendTemplateMessage() from @/lib/whatsapp, then
// record the send in whatsapp_messages including the provider's message id.
// BSP-approved templates only — no free-text sends (PRD §9 Compliance).
// Scoping: derive tenantId from the session; verify the clinic belongs to it
// and that the patient belongs to that clinic before sending.

export async function POST() {
  return notImplemented("POST /api/whatsapp/send");
}
