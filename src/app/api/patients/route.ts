import { BadRequestError, jsonOk, toErrorResponse } from "@/lib/apiHandler";
import { findPatientsForActor } from "@/lib/registrations";
import { requireActor } from "@/lib/session";

// Patient lookup — PRD §6.3 (FR-3.1), the return-visit path.
//
// NOTE: docs/PROJECT_STRUCTURE.md does not list a patients route. It is added
// because a follow-up visit has to attach to the Patient record that already
// exists — the alternative is minting a second Patient ID for the same person,
// which defeats the point of `patients` and `registrations` being separate
// tables. The PRD's data model already assumes one patient, many visits.
//
// Read-only by design: patients are created through POST /api/registrations, so
// there is exactly one code path that mints a `PT-YYYY-####` code.
//
// `clinicId` is required rather than optional. This hands back names, phone
// numbers and addresses, so the caller must say which clinic they are working
// in and hold `patient:read` there — @/lib/registrations enforces both.

export async function GET(request: Request) {
  try {
    const actor = await requireActor();
    const params = new URL(request.url).searchParams;

    const clinicId = params.get("clinicId")?.trim();
    if (!clinicId) {
      throw new BadRequestError("A clinic is required to look up patients.");
    }

    const search = params.get("search") ?? "";
    const startDate = params.get("startDate") ?? undefined;
    const endDate = params.get("endDate") ?? undefined;

    return jsonOk(await findPatientsForActor(actor, clinicId, search, startDate, endDate));
  } catch (error: unknown) {
    return toErrorResponse(error, "GET /api/patients");
  }
}
