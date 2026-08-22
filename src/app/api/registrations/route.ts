import { NextResponse } from "next/server";
import { jsonOk, readJsonBody, toErrorResponse } from "@/lib/apiHandler";
import { todayDateOnly } from "@/lib/dates";
import {
  registrationCsvFilename,
  toRegistrationCsv,
} from "@/lib/registrationCsv";
import {
  createRegistration,
  createRegistrationSchema,
  listRegistrationsForActor,
  listRegistrationsForExport,
  parseRegistrationFilters,
} from "@/lib/registrations";
import { requireActor } from "@/lib/session";
import { MODULE_FEATURES, requireModule } from "@/lib/features";

// Registrations — PRD §6.3 (FR-3.1 … FR-3.4).
//
// GET carries the search and filter set, and switches to a CSV download with
// ?format=csv (FR-3.4). Every filter — clinicId included — is a filter and not
// an authorisation: @/lib/registrations intersects it with the caller's own
// clinic scope, so naming a clinic they cannot reach returns nothing rather
// than widening the result.
//
// POST creates the patient, the registration and the first audit-log row in one
// transaction (FR-3.6). There is no DELETE: `registration_edit_log` is
// append-only and the PRD describes no way to remove a visit, whose amount the
// revenue reports are built from.

export async function GET(request: Request) {
  try {
    const actor = await requireActor();
    await requireModule(actor, MODULE_FEATURES.registrations);
    const params = new URL(request.url).searchParams;
    const filters = parseRegistrationFilters(Object.fromEntries(params));

    if (params.get("format") === "csv") {
      const records = await listRegistrationsForExport(actor, filters);
      const today = todayDateOnly();

      return new NextResponse(toRegistrationCsv(records), {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${registrationCsvFilename(today)}"`,
          // Patient data — never cached by a proxy on the way back.
          "Cache-Control": "no-store",
        },
      });
    }

    return jsonOk(await listRegistrationsForActor(actor, filters));
  } catch (error: unknown) {
    return toErrorResponse(error, "GET /api/registrations");
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireActor();
    await requireModule(actor, MODULE_FEATURES.registrations);
    const input = createRegistrationSchema.parse(await readJsonBody(request));
    return jsonOk(await createRegistration(actor, input), 201);
  } catch (error: unknown) {
    return toErrorResponse(error, "POST /api/registrations");
  }
}
