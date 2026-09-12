import {
  prescriptionErrorResponse,
  prescriptionJsonOk,
} from "@/lib/prescriptionApi";
import { readJsonBody } from "@/lib/apiHandler";
import { requireActor } from "@/lib/session";
import { issuePrescription } from "@/lib/prescriptions";
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    return prescriptionJsonOk(
      await issuePrescription(
        await requireActor(),
        id,
        await readJsonBody(request),
      ),
    );
  } catch (error) {
    return prescriptionErrorResponse(error, "POST prescription issue");
  }
}
