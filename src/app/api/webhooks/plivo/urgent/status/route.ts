import { resolveInboundClinicByPlivoNumber } from "@/lib/telephony/clinicConfig";
import { buildUrgentTransferFailureXml } from "@/lib/telephony/plivo";
import { verifyPlivoV3Webhook } from "@/lib/telephony/security";
import { buildUrgentDialOutcomeXml } from "@/lib/telephony/urgent";

export const runtime = "nodejs";

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
    const sourceNumbers = new URL(request.url).searchParams.getAll(
      "sourceNumber",
    );
    if (sourceNumbers.length !== 1) {
      return xmlResponse(buildUrgentTransferFailureXml());
    }
    const clinic = await resolveInboundClinicByPlivoNumber(sourceNumbers[0]);
    if (!clinic) return xmlResponse(buildUrgentTransferFailureXml());

    const status = verification.params.DialStatus;
    return xmlResponse(
      buildUrgentDialOutcomeXml(
        typeof status === "string" ? status : undefined,
      ),
    );
  } catch {
    console.error("Could not process the Plivo urgent Dial callback.");
    return new Response("Service unavailable.", { status: 503 });
  }
}

function xmlResponse(xml: string): Response {
  return new Response(xml, {
    status: 200,
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
