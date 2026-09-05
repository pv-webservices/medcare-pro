import { jsonOk, toErrorResponse } from "@/lib/apiHandler";
import { requireActor } from "@/lib/session";
import { resolveTelephonyBookingFollowUpForActor } from "@/lib/telephony/bookingFollowUps";

interface RouteContext {
  params: Promise<{ clinicId: string; requestId: string }>;
}

export async function POST(_request: Request, context: RouteContext) {
  try {
    const actor = await requireActor();
    const { clinicId, requestId } = await context.params;
    return jsonOk(
      await resolveTelephonyBookingFollowUpForActor(
        actor,
        clinicId,
        requestId,
      ),
    );
  } catch (error: unknown) {
    return toErrorResponse(
      error,
      "POST /api/clinics/[clinicId]/telephony/booking-follow-ups/[requestId]/resolve",
    );
  }
}
