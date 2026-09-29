import { NextResponse } from "next/server";
import { BadRequestError } from "@/lib/apiHandler";
import { billingErrorResponse, billingJsonOk } from "@/lib/billing/billingApi";
import { collectionsCsvFilename, isCollectionsExportSection, toCollectionsCsv } from "@/lib/billing/collectionsCsv";
import { getCollectionsReport, getCollectionsReportForExport } from "@/lib/billing/collectionsReport";
import { reportFilterSchema } from "@/lib/reports";
import { requireActor } from "@/lib/session";

// Collections report — billing PRD FR-11.23. Read-only.
//
// Gated by the `reports` and `billing` features and by `report:read` AND
// `invoice:read`; the clinic list is the intersection of both grants, resolved
// in @/lib/billing/collectionsReport. `clinicId` is a filter, never an
// authorisation: a clinic outside that intersection returns zeros.
//
// ?format=csv&section=trend|modes|clinics additionally needs `reports:export`.

export async function GET(request: Request) {
  try {
    const actor = await requireActor();
    const params = new URL(request.url).searchParams;
    const filters = reportFilterSchema.parse({
      period: params.get("period") ?? undefined,
      clinicId: params.get("clinicId") ?? undefined,
    });
    if (params.get("format") !== "csv") return billingJsonOk(await getCollectionsReport(actor, filters));

    const section = params.get("section") ?? "";
    if (!isCollectionsExportSection(section)) {
      throw new BadRequestError("Name the part of the report to export: trend, modes or clinics.");
    }
    const report = await getCollectionsReportForExport(actor, filters);
    return new NextResponse(toCollectionsCsv(report, section), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${collectionsCsvFilename(report, section)}"`,
        "Cache-Control": "private, no-store, max-age=0",
      },
    });
  } catch (error: unknown) {
    return billingErrorResponse(error, "GET /api/reports/collections");
  }
}
