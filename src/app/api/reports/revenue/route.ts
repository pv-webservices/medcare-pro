import { jsonOk, toErrorResponse } from "@/lib/apiHandler";
import { getRevenueReport, reportFilterSchema } from "@/lib/reports";
import { requireActor } from "@/lib/session";

// Revenue report — PRD §6.6 (FR-6.1 … FR-6.4). Aggregates registrations by
// visit_date over daily/weekly/monthly/yearly windows, broken down by clinic
// and by doctor.
//
// Read-only: there is no POST here, and nothing in @/lib/reports writes.
//
// Scoping: tenantId comes from the session. `clinicId` is a filter, not an
// authorisation — @/lib/reports resolves the clinics the caller may actually
// report on first and constrains every query, including the raw aggregation,
// to that explicit id list. A caller holding `report:read` nowhere gets a 403;
// one who names a clinic outside their reach gets zeros, not another clinic's
// revenue.

export async function GET(request: Request) {
  try {
    const actor = await requireActor();
    const params = new URL(request.url).searchParams;

    const filters = reportFilterSchema.parse({
      period: params.get("period") ?? undefined,
      clinicId: params.get("clinicId") ?? undefined,
    });

    return jsonOk(await getRevenueReport(actor, filters));
  } catch (error: unknown) {
    return toErrorResponse(error, "GET /api/reports/revenue");
  }
}
