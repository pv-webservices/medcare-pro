import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { BadRequestError, readJsonBody } from "@/lib/apiHandler";
import { PermissionError, ScopeError } from "@/lib/rbac";
import { UnauthenticatedError } from "@/lib/session";
import { RateLimitError } from "@/lib/rateLimit";
import {
  PatientPortalError,
  assertPortalOrigin,
} from "@/lib/patientPortalSecurity";
export { readJsonBody };
export function portalJson(data: unknown) {
  return NextResponse.json(
    { success: true, data },
    {
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        "Referrer-Policy": "no-referrer",
      },
    },
  );
}
export async function portalApi(
  request: Request,
  work: () => Promise<NextResponse>,
) {
  try {
    if (request.method !== "GET") assertPortalOrigin(request);
    return await work();
  } catch (error) {
    const status =
      error instanceof PatientPortalError
        ? error.status
        : error instanceof UnauthenticatedError
          ? 401
          : error instanceof ScopeError
            ? 404
            : error instanceof PermissionError
              ? 403
              : error instanceof RateLimitError
                ? 429
                : error instanceof ZodError || error instanceof BadRequestError
                  ? 400
                  : 503;
    const message =
      error instanceof PatientPortalError || error instanceof RateLimitError
        ? error.message
        : status === 404
          ? "Not found."
          : status === 400
            ? "Check the submitted values."
            : status === 401
              ? "Please sign in."
              : status === 403
                ? "This request could not be accepted."
                : "Patient Portal is unavailable. Please try again later.";
    // Deliberately never log Prisma errors, request URLs, tokens or clinical payloads.
    return NextResponse.json(
      { success: false, error: message },
      {
        status,
        headers: {
          "Cache-Control": "private, no-store",
          "Referrer-Policy": "no-referrer",
        },
      },
    );
  }
}
