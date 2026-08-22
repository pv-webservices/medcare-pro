import { NextResponse } from "next/server";
import { BadRequestError, jsonOk, toErrorResponse } from "@/lib/apiHandler";
import {
  isReportExportSection,
  reportCsvFilename,
  toReportCsv,
} from "@/lib/reportCsv";
import {
  getRevenueReport,
  getRevenueReportForExport,
  reportFilterSchema,
} from "@/lib/reports";
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
//
// ?format=csv downloads one section of the report (Stage 7) and needs
// `reports:export` ON TOP of the view gate — @/lib/reports intersects the two,
// so the file can never hold a clinic the caller is refused on screen.

export async function GET(request: Request) {
  try {
    const actor = await requireActor();
    const params = new URL(request.url).searchParams;

    const filters = reportFilterSchema.parse({
      period: params.get("period") ?? undefined,
      clinicId: params.get("clinicId") ?? undefined,
    });

    if (params.get("format") !== "csv") {
      return jsonOk(await getRevenueReport(actor, filters));
    }

    // Named rather than defaulted: the three sections are three different
    // files, and guessing which one was meant would hand someone the wrong
    // figures under a plausible filename.
    const section = params.get("section") ?? "";
    if (!isReportExportSection(section)) {
      throw new BadRequestError(
        "Name the part of the report to export: trend, clinics or doctors.",
      );
    }

    const report = await getRevenueReportForExport(actor, filters);

    return new NextResponse(toReportCsv(report, section), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${reportCsvFilename(report, section)}"`,
        // Revenue figures — never cached by a proxy on the way back.
        "Cache-Control": "no-store",
      },
    });
  } catch (error: unknown) {
    return toErrorResponse(error, "GET /api/reports/revenue");
  }
}
