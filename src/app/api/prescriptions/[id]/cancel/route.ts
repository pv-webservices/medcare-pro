import {
  prescriptionErrorResponse,
  prescriptionJsonOk,
} from "@/lib/prescriptionApi";
import { readJsonBody } from "@/lib/apiHandler";
import { requireActor } from "@/lib/session";
import { cancelPrescription } from "@/lib/prescriptions";
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    return prescriptionJsonOk(
      await cancelPrescription(
        await requireActor(),
        id,
        await readJsonBody(request),
      ),
    );
  } catch (error) {
    return prescriptionErrorResponse(error, "POST prescription cancel");
  }
}
