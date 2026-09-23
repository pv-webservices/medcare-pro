import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { BadRequestError, ConflictError } from "@/lib/domainErrors";
import { UnauthenticatedError } from "@/lib/session";
import { PermissionError, ScopeError } from "@/lib/rbac";
import { FeatureError } from "@/lib/featureResolution";
import { ClinicalAudioDisabledError } from "@/lib/clinical-audio/errors";
import { ClinicalFactsDisabledError } from "./config";

const headers = { "Cache-Control": "private, no-store, max-age=0" };

export function factsJson(data: unknown, status = 200) {
  return NextResponse.json({ success: true, data }, { status, headers });
}

/** Fixed, PHI-free messages. ConflictError messages are authored in the
 * fact service (state guidance only), so they are safe to show. */
export function factsError(error: unknown) {
  const [status, message] =
    error instanceof UnauthenticatedError
      ? [401, "You are not signed in."]
      : error instanceof ScopeError
        ? [404, "Not found."]
        : error instanceof PermissionError ||
            error instanceof FeatureError ||
            error instanceof ClinicalAudioDisabledError ||
            error instanceof ClinicalFactsDisabledError
          ? [403, "Clinical fact extraction is not available for this consultation."]
          : error instanceof ConflictError
            ? [409, error.message]
            : error instanceof ZodError ||
                error instanceof BadRequestError ||
                error instanceof SyntaxError
              ? [400, "Check the request."]
              : [503, "Clinical fact extraction is temporarily unavailable."];
  return NextResponse.json({ success: false, error: message }, { status, headers });
}
