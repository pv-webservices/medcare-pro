import {
  prescriptionErrorResponse,
  prescriptionJsonOk,
} from "@/lib/prescriptionApi";
import { readJsonBody } from "@/lib/apiHandler";
import { requireActor } from "@/lib/session";
import {
  getConsultationForRegistration,
  saveConsultationDraft,
} from "@/lib/prescriptions";
import { prescriptionDraftSchema } from "@/lib/prescriptionValidation";
type Context = { params: Promise<{ id: string }> };
export async function GET(_request: Request, context: Context) {
  try {
    const actor = await requireActor();
    const { id } = await context.params;
    return prescriptionJsonOk(await getConsultationForRegistration(actor, id));
  } catch (error) {
    return prescriptionErrorResponse(error, "GET consultation");
  }
}
export async function POST(request: Request, context: Context) {
  try {
    const actor = await requireActor();
    const { id } = await context.params;
    return prescriptionJsonOk(
      await saveConsultationDraft(
        actor,
        id,
        prescriptionDraftSchema.parse(await readJsonBody(request)),
      ),
    );
  } catch (error) {
    return prescriptionErrorResponse(error, "POST consultation");
  }
}
