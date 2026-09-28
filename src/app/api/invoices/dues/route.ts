import { NextResponse } from "next/server";
import { requireActor } from "@/lib/session";
import { billingJsonOk, billingErrorResponse } from "@/lib/billing/billingApi";
import { listDuesForActor, listDuesForExport } from "@/lib/billing/dues";
import { duesCsvFilename, toDuesCsv } from "@/lib/billing/duesCsv";

// FR-11.18. ?format=csv needs reports:export ON TOP of invoice:read; the file is
// the list on screen, intersected with the export grant.
export async function GET(request: Request) {
  try {
    const actor = await requireActor();
    const { format, ...query } = Object.fromEntries(new URL(request.url).searchParams);
    if (format !== "csv") return billingJsonOk(await listDuesForActor(actor, query));

    const { page: _page, ...filters } = query;
    return new NextResponse(toDuesCsv(await listDuesForExport(actor, filters)), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${duesCsvFilename()}"`,
        "Cache-Control": "private, no-store, max-age=0",
      },
    });
  } catch (error) { return billingErrorResponse(error, "GET dues"); }
}
