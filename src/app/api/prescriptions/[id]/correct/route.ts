import {
  prescriptionErrorResponse,
  prescriptionJsonOk,
} from "@/lib/prescriptionApi";
import { readOptionalJsonBody } from "@/lib/apiHandler";
import { requireActor } from "@/lib/session";
import { createCorrectedPrescription } from "@/lib/prescriptions";
import { correctionPrescriptionSchema } from "@/lib/prescriptionValidation";
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    correctionPrescriptionSchema.parse(await readOptionalJsonBody(request));
    const { id } = await context.params;
    return prescriptionJsonOk(
      await createCorrectedPrescription(await requireActor(), id),
    );
  } catch (error) {
    return prescriptionErrorResponse(error, "POST prescription correct");
  }
}
