import {
  prescriptionErrorResponse,
  prescriptionJsonOk,
} from "@/lib/prescriptionApi";
import { requireActor } from "@/lib/session";
import { listPrescriptionsForActor } from "@/lib/prescriptions";
export async function GET(request: Request) {
  try {
    return prescriptionJsonOk(
      await listPrescriptionsForActor(
        await requireActor(),
        Object.fromEntries(new URL(request.url).searchParams),
      ),
    );
  } catch (error) {
    return prescriptionErrorResponse(error, "GET prescriptions");
  }
}
