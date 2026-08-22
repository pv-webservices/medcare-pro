import { NextResponse } from "next/server";
import { jsonOk, toErrorResponse } from "@/lib/apiHandler";
import { requirePlatformOwner } from "@/lib/platform/auth";
import {
  listAuditLog,
  listAuditLogForExport,
  ownerAuditFilterSchema,
} from "@/lib/platform/auditLog";
import { auditCsvFilename, toAuditCsv } from "@/lib/auditCsv";

/**
 * The cross-tenant audit trail — Stage 11, Owner surface.
 *
 * `requirePlatformOwner()` is the whole gate and runs before anything else: it
 * re-reads the session registry and the account's platform role from the
 * database on every call. A signed-in clinic user gets 404 from
 * toErrorResponse, the same answer as an unknown URL.
 *
 * GET returns one page. `?format=csv` returns the same query as a file, capped
 * at OWNER_AUDIT_EXPORT_MAX newest rows — see the note there on why an
 * uncapped export of an append-only table is a trap.
 *
 * There is no POST, PATCH or DELETE, and there never will be. `audit_logs` is
 * append-only; an endpoint that could edit it would defeat the only thing the
 * table is for.
 */

export async function GET(request: Request) {
  try {
    const owner = await requirePlatformOwner();
    const params = new URL(request.url).searchParams;

    const filters = ownerAuditFilterSchema.parse({
      category: params.get("category") ?? undefined,
      action: params.get("action") ?? undefined,
      tenantId: params.get("tenantId") ?? undefined,
      search: params.get("search") ?? undefined,
      from: params.get("from") ?? undefined,
      to: params.get("to") ?? undefined,
      page: params.get("page") ?? undefined,
    });

    if (params.get("format") === "csv") {
      const { entries, truncated, total } = await listAuditLogForExport(
        owner,
        filters,
      );

      return new NextResponse(toAuditCsv(entries), {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${auditCsvFilename()}"`,
          // Never cached: an audit export is exactly the kind of response that
          // must not sit in a shared proxy.
          "Cache-Control": "no-store",
          // Tells the caller the cap bit without changing the file's shape, so
          // a narrower date range is an obvious next step rather than a silent
          // truncation nobody notices.
          "X-Audit-Total": String(total),
          "X-Audit-Truncated": truncated ? "1" : "0",
        },
      });
    }

    return jsonOk(await listAuditLog(owner, filters));
  } catch (error: unknown) {
    return toErrorResponse(error, "GET /api/owner/audit");
  }
}
