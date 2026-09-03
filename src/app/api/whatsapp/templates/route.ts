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
import { MODULE_FEATURES, requireModule } from "@/lib/features";

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

export async function GET(request: Request) {
  try {
    const actor = await requireActor();
    await requireModule(actor, MODULE_FEATURES.whatsapp);
    const url = new URL(request.url);
    const clinicId = url.searchParams.get("clinicId")?.trim() ?? null;
    return jsonOk(await listTemplatesForActor(actor, clinicId));
  } catch (error: unknown) {
    return toErrorResponse(error, "GET /api/whatsapp/templates");
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireActor();
    await requireModule(actor, MODULE_FEATURES.whatsapp);
    const input = createTemplateSchema.parse(await readJsonBody(request));

    return jsonOk(await createTemplate(actor, input), 201);
  } catch (error: unknown) {
    return toErrorResponse(error, "POST /api/whatsapp/templates");
  }
}

export async function PATCH(request: Request) {
  try {
    const actor = await requireActor();
    await requireModule(actor, MODULE_FEATURES.whatsapp);
    const input = updateTemplateSchema.parse(await readJsonBody(request));

    return jsonOk(await updateTemplate(actor, input));
  } catch (error: unknown) {
    return toErrorResponse(error, "PATCH /api/whatsapp/templates");
  }
}

export async function DELETE(request: Request) {
  try {
    const actor = await requireActor();
    await requireModule(actor, MODULE_FEATURES.whatsapp);
    const { templateId } = deleteTemplateSchema.parse(await readJsonBody(request));

    return jsonOk(await deleteTemplate(actor, templateId));
  } catch (error: unknown) {
    return toErrorResponse(error, "DELETE /api/whatsapp/templates");
  }
}
