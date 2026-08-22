import { z } from "zod";
import { jsonOk, readJsonBody, toErrorResponse } from "@/lib/apiHandler";
import { requirePlatformOwner } from "@/lib/platform/auth";
import { decideOnClinicApplication } from "@/lib/platform/decisions";
import {
  CLINIC_DECISIONS,
  MAX_REASON_LENGTH,
} from "@/lib/platform/decisionPolicy";
import { readClientIp, readUserAgent } from "@/lib/requestMeta";
import { EmailDeliveryError } from "@/lib/email";
import {
  sendClinicReactivatedEmail,
  sendClinicSuspendedEmail,
  sendRegistrationApprovedEmail,
  sendRegistrationRejectedEmail,
} from "@/lib/registrationEmails";

/**
 * Approve, reject, suspend or reactivate a clinic — Stage 3 items 6 to 12.
 *
 * ONE endpoint for all four decisions rather than four. They share a target, an
 * authorization check, a reason policy and an audit shape; splitting them would
 * mean four places to keep those in step, and four chances for one of them to
 * drift.
 *
 * The decision commits in a single transaction inside decideOnClinicApplication.
 * The applicant's email is sent AFTERWARDS and its failure is reported without
 * undoing anything — see the note at the send site.
 */

const decisionSchema = z.object({
  decision: z.enum([
    CLINIC_DECISIONS.APPROVE,
    CLINIC_DECISIONS.REJECT,
    CLINIC_DECISIONS.SUSPEND,
    CLINIC_DECISIONS.REACTIVATE,
  ]),
  reason: z.string().trim().max(MAX_REASON_LENGTH).optional(),
  planKey: z.string().trim().max(64).optional(),
  features: z
    .array(
      z.object({
        featureKey: z.string().trim().min(1).max(64),
        enabled: z.boolean(),
      }),
    )
    .max(100)
    .optional(),
  entitlementReason: z.string().trim().max(MAX_REASON_LENGTH).optional(),
});

interface RouteContext {
  // Next 16 hands route params to the handler as a promise.
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const owner = await requirePlatformOwner();
    const { id } = await context.params;
    const input = decisionSchema.parse(await readJsonBody(request));

    const outcome = await decideOnClinicApplication(owner, {
      tenantId: id,
      decision: input.decision,
      reason: input.reason ?? null,
      planKey: input.planKey ?? null,
      features: input.features ?? [],
      entitlementReason: input.entitlementReason ?? null,
      ip: readClientIp(request),
      userAgent: readUserAgent(request),
    });

    // Stage 3 item 12. Deliberately outside the transaction and deliberately
    // non-fatal: the decision is already committed and audited, and rolling an
    // approval back because a mail server timed out would leave the Owner
    // believing they had approved nothing. The caller is told instead, and can
    // reach the applicant by hand.
    let applicantNotified = true;
    try {
      const params = { to: outcome.email, clinicName: outcome.clinicName };

      if (outcome.decision === CLINIC_DECISIONS.APPROVE) {
        await sendRegistrationApprovedEmail(params);
      } else if (outcome.decision === CLINIC_DECISIONS.REJECT) {
        await sendRegistrationRejectedEmail({
          ...params,
          reason: outcome.reason ?? "",
        });
      } else if (outcome.decision === CLINIC_DECISIONS.SUSPEND) {
        await sendClinicSuspendedEmail({
          ...params,
          reason: outcome.reason ?? "",
        });
      } else {
        await sendClinicReactivatedEmail(params);
      }
    } catch (error: unknown) {
      applicantNotified = false;
      const detail =
        error instanceof EmailDeliveryError ? error.message : "Unknown error";
      console.error(
        `Decision mail failed for tenant ${outcome.tenantId}: ${detail}`,
      );
    }

    return jsonOk({ ...outcome, applicantNotified });
  } catch (error: unknown) {
    return toErrorResponse(error, "POST /api/owner/applications/[id]/decision");
  }
}
