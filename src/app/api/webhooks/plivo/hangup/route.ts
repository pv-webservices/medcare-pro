import { resolveInboundClinicByPlivoNumber } from "@/lib/telephony/clinicConfig";
import { completeObservedProductionCall } from "@/lib/telephony/callObservability";
import { verifyPlivoV3Webhook } from "@/lib/telephony/security";

export const runtime = "nodejs";

/** Intended for the Plivo Voice Application Hangup URL configured in Phase 7. */
export async function POST(request: Request): Promise<Response> {
  const verification = await verifyPlivoV3Webhook(request);
  if (!verification.ok) {
    if (verification.reason === "missing-configuration") {
      console.error("Plivo webhook validation is not configured.");
      return new Response("Service unavailable.", { status: 503 });
    }
    return new Response("Forbidden.", { status: 403 });
  }

  try {
    const clinic = await resolveInboundClinicByPlivoNumber(
      verification.params.To,
    );
    if (!clinic) return accepted();

    const result = await completeObservedProductionCall({
      clinicId: clinic.clinicId,
      providerCallUuid: verification.params.CallUUID,
      duration: verification.params.Duration,
    });
    if (result !== "recorded") {
      console.error("Production call Hangup observation was safely ignored.", {
        reason: result,
      });
    }
    return accepted();
  } catch {
    // A signed completion callback must not be retried endlessly because the
    // secondary diagnostic store is unavailable.
    console.error("Production call Hangup observation could not be processed.");
    return accepted();
  }
}

function accepted(): Response {
  return new Response("", {
    status: 200,
    headers: { "Cache-Control": "no-store" },
  });
}
