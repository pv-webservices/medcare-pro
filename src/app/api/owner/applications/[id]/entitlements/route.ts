import { z } from "zod";
import { jsonOk, readJsonBody, toErrorResponse } from "@/lib/apiHandler";
import { requirePlatformOwner } from "@/lib/platform/auth";
import {
  getTenantEntitlements,
  setTenantEntitlements,
} from "@/lib/platform/entitlements";
import { MAX_REASON_LENGTH } from "@/lib/platform/entitlementPolicy";
import { readClientIp, readUserAgent } from "@/lib/requestMeta";

/**
 * One organisation's plan and feature overrides — Stage 9, layer 2b.
 *
 * Sits under /applications/[id] rather than a new /tenants space because an
 * application and an organisation are the same row: giving it a second URL
 * prefix would mean two places to look for one clinic, and two places to keep
 * the "is this the reserved platform tenant" filter.
 *
 * Unlike the decision endpoint next door, this one is not tied to a status
 * transition — it changes entitlements and nothing else, and takes no decision,
 * assigns no role and sends no mail.
 */

const putSchema = z.object({
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
  reason: z.string().trim().max(MAX_REASON_LENGTH).optional(),
});

interface RouteContext {
  // Next 16 hands route params to the handler as a promise.
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const owner = await requirePlatformOwner();
    const { id } = await context.params;

    return jsonOk(await getTenantEntitlements(owner, id));
  } catch (error: unknown) {
    return toErrorResponse(
      error,
      "GET /api/owner/applications/[id]/entitlements",
    );
  }
}

export async function PUT(request: Request, context: RouteContext) {
  try {
    const owner = await requirePlatformOwner();
    const { id } = await context.params;
    const input = putSchema.parse(await readJsonBody(request));

    return jsonOk(
      await setTenantEntitlements(owner, {
        tenantId: id,
        planKey: input.planKey ?? null,
        features: input.features ?? [],
        reason: input.reason ?? null,
        ip: readClientIp(request),
        userAgent: readUserAgent(request),
      }),
    );
  } catch (error: unknown) {
    return toErrorResponse(
      error,
      "PUT /api/owner/applications/[id]/entitlements",
    );
  }
}
