import {
  buildPlivoInputActionUrl,
  buildStage2SelectionXml,
} from "@/lib/telephony/plivo";
import { resolveMainMenuAction } from "@/lib/telephony/routing";
import { verifyPlivoV3Webhook } from "@/lib/telephony/security";

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

  const validatedDigits = verification.params.Digits;
  const digits =
    typeof validatedDigits === "string" ? validatedDigits : undefined;
  const action = resolveMainMenuAction(digits);

  try {
    const inputActionUrl = buildPlivoInputActionUrl(request.url);
    return new Response(buildStage2SelectionXml(action, inputActionUrl), {
      status: 200,
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch {
    console.error("Could not generate the Plivo Stage 2 input XML.");
    return new Response("Service unavailable.", { status: 503 });
  }
}
