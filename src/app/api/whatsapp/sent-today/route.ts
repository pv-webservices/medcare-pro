import { BadRequestError, jsonOk, toErrorResponse } from "@/lib/apiHandler";
import { requireActor } from "@/lib/session";
import { listSentTemplateToday } from "@/lib/whatsappMessages";
import { MODULE_FEATURES, requireModule } from "@/lib/features";

// "Already sent today" markers for the composer — which of a clinic's patients,
// and which mobile numbers, have received this template today, so the front
// desk sees it before sending.
//
// Read-only and advisory: POST /api/whatsapp/send enforces the same rule
// itself and skips those patients, so a stale marker can never cause a
// duplicate. Requires `message:send` in the named clinic.

export async function GET(request: Request) {
  try {
    const actor = await requireActor();
    await requireModule(actor, MODULE_FEATURES.whatsapp);
    const params = new URL(request.url).searchParams;

    const templateId = params.get("templateId")?.trim();
    const clinicId = params.get("clinicId")?.trim();
    if (!templateId || !clinicId) {
      throw new BadRequestError("A template and a clinic are required.");
    }

    return jsonOk(await listSentTemplateToday(actor, templateId, clinicId));
  } catch (error: unknown) {
    return toErrorResponse(error, "GET /api/whatsapp/sent-today");
  }
}
