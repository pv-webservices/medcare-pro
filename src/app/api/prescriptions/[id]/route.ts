import {
  prescriptionErrorResponse,
  prescriptionJsonOk,
} from "@/lib/prescriptionApi";
import { requireActor } from "@/lib/session";
import { getPrescriptionForActor } from "@/lib/prescriptions";
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    return prescriptionJsonOk(
      await getPrescriptionForActor(await requireActor(), id),
    );
  } catch (error) {
    return prescriptionErrorResponse(error, "GET prescription");
  }
}
