import { jsonOk, readJsonBody, toErrorResponse } from "@/lib/apiHandler";
import { requireActor } from "@/lib/session";
import {
  createTemplate,
  createTemplateSchema,
  deleteTemplate,
  deleteTemplateSchema,
  listTemplatesForActor,
  updateTemplate,
  updateTemplateSchema,
} from "@/lib/whatsappTemplates";

// WhatsApp message templates — PRD §6.9 (FR-9.1).
//
// Not in docs/PROJECT_STRUCTURE.md, which predates the provider decision: it
// lists only `whatsapp/send` and `whatsapp/webhook` because the PRD assumed an
// official BSP holding the approved templates. RkvRobo has no template
// approval, so the approved set is stored and edited here instead.
//
// `message:template` gates every write; `message:send` is enough to read the
// list, since anyone who may send needs to choose from it. That split is the
// point — a receptionist can send the wording but not rewrite it.

export async function GET() {
  try {
    const actor = await requireActor();
    return jsonOk(await listTemplatesForActor(actor));
  } catch (error: unknown) {
    return toErrorResponse(error, "GET /api/whatsapp/templates");
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireActor();
    const input = createTemplateSchema.parse(await readJsonBody(request));

    return jsonOk(await createTemplate(actor, input), 201);
  } catch (error: unknown) {
    return toErrorResponse(error, "POST /api/whatsapp/templates");
  }
}

export async function PATCH(request: Request) {
  try {
    const actor = await requireActor();
    const input = updateTemplateSchema.parse(await readJsonBody(request));

    return jsonOk(await updateTemplate(actor, input));
  } catch (error: unknown) {
    return toErrorResponse(error, "PATCH /api/whatsapp/templates");
  }
}

export async function DELETE(request: Request) {
  try {
    const actor = await requireActor();
    const { templateId } = deleteTemplateSchema.parse(await readJsonBody(request));

    return jsonOk(await deleteTemplate(actor, templateId));
  } catch (error: unknown) {
    return toErrorResponse(error, "DELETE /api/whatsapp/templates");
  }
}
