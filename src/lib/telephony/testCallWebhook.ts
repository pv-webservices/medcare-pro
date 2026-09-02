import type { ValidatedPlivoParams } from "@/lib/telephony/security";
import { TelephonyTestCallCallbackError } from "@/lib/telephony/testCall";

export function verifiedTestCallId(requestUrl: string): string {
  const values = new URL(requestUrl).searchParams.getAll("testCallId");
  if (values.length !== 1 || values[0]!.trim() === "") {
    throw new TelephonyTestCallCallbackError(404);
  }
  return values[0]!;
}

export function oneValidatedPlivoValue(
  params: ValidatedPlivoParams,
  key: string,
): string | undefined {
  const value = params[key];
  return typeof value === "string" ? value : undefined;
}

export function telephonyTestCallbackErrorResponse(
  error: unknown,
): Response | null {
  if (error instanceof TelephonyTestCallCallbackError) {
    return new Response(error.message, {
      status: error.responseStatus,
      headers: { "Cache-Control": "no-store" },
    });
  }
  return null;
}

export function testCallXmlResponse(xml: string): Response {
  return new Response(xml, {
    status: 200,
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
