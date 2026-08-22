import { z } from "zod";
import { jsonOk, toErrorResponse } from "@/lib/apiHandler";
import { requirePlatformOwner } from "@/lib/platform/auth";
import { listClinicApplications } from "@/lib/platform/applications";

/**
 * The Owner's clinic application queue — Stage 3 item 5.
 *
 * The first API route on the platform surface. `requirePlatformOwner()` is the
 * whole gate and it runs before anything else in the handler: it re-reads the
 * session registry and the account's platform role from the database on every
 * call. There is no middleware check standing in for it — the middleware runs on
 * the edge and can only see the JWT.
 *
 * A signed-in clinic user gets 404 from toErrorResponse, the same answer as an
 * unknown URL, so this route does not confirm its own existence to them.
 */

const querySchema = z.object({
  status: z
    .enum(["PENDING", "ACTIVE", "SUSPENDED", "REJECTED", "ARCHIVED"])
    .optional(),
  search: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).max(1000).optional(),
});

export async function GET(request: Request) {
  try {
    const owner = await requirePlatformOwner();

    const url = new URL(request.url);
    const query = querySchema.parse({
      status: url.searchParams.get("status") ?? undefined,
      search: url.searchParams.get("search") ?? undefined,
      page: url.searchParams.get("page") ?? undefined,
    });

    return jsonOk(
      await listClinicApplications(owner, {
        status: query.status ?? null,
        search: query.search ?? null,
        page: query.page ?? 1,
      }),
    );
  } catch (error: unknown) {
    return toErrorResponse(error, "GET /api/owner/applications");
  }
}
