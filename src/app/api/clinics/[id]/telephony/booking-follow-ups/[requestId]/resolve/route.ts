import { jsonOk, toErrorResponse } from "@/lib/apiHandler";
import { requireActor } from "@/lib/session";
import { resolveTelephonyBookingFollowUpForActor } from "@/lib/telephony/bookingFollowUps";

interface RouteContext {
  params: Promise<{ id: string; requestId: string }>;
}

export async function POST(_request: Request, context: RouteContext) {
  try {
    const actor = await requireActor();
    const { id, requestId } = await context.params;
    return jsonOk(
      await resolveTelephonyBookingFollowUpForActor(actor, id, requestId),
    );
  } catch (error: unknown) {
    return toErrorResponse(
      error,
      "POST /api/clinics/[id]/telephony/booking-follow-ups/[requestId]/resolve",
    );
  }
}
