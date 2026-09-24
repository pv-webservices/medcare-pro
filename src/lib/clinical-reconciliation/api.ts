import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { BadRequestError } from "@/lib/domainErrors";
import { UnauthenticatedError } from "@/lib/session";
import { PermissionError, ScopeError } from "@/lib/rbac";
import { FeatureError } from "@/lib/featureResolution";
import { ClinicalAudioDisabledError } from "@/lib/clinical-audio/errors";
import { ClinicalFactsDisabledError } from "@/lib/clinical-facts/config";
import { ClinicalReconciliationDisabledError } from "./config";

const headers = { "Cache-Control": "private, no-store, max-age=0" };

export function reconciliationJson(data: unknown) {
  return NextResponse.json({ success: true, data }, { headers });
}

/** Fixed, PHI-free messages only. */
export function reconciliationError(error: unknown) {
  const [status, message] =
    error instanceof UnauthenticatedError
      ? [401, "You are not signed in."]
      : error instanceof ScopeError
        ? [404, "Not found."]
        : error instanceof PermissionError ||
            error instanceof FeatureError ||
            error instanceof ClinicalAudioDisabledError ||
            error instanceof ClinicalFactsDisabledError ||
            error instanceof ClinicalReconciliationDisabledError
          ? [403, "Checking against the consultation is not available for this prescription."]
          : error instanceof ZodError || error instanceof BadRequestError || error instanceof SyntaxError
            ? [400, "Check the request."]
            : [503, "Checking against the consultation is temporarily unavailable."];
  return NextResponse.json({ success: false, error: message }, { status, headers });
}
