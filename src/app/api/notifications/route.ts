import { jsonOk, readJsonBody, toErrorResponse } from "@/lib/apiHandler";
import {
  listNotificationsForActor,
  markNotificationsForActor,
  markNotificationsSchema,
  notificationFilterSchema,
} from "@/lib/notifications";
import { requireActor } from "@/lib/session";
import { MODULE_FEATURES, requireModule } from "@/lib/features";

// Notifications — PRD §6.7 (FR-7.1, FR-7.2). PATCH marks read/unread.
//
// Nothing here creates a notification: FR-7.1 says they are raised BY a record
// modification, so the writes live beside those mutations in @/lib/clinics,
// @/lib/doctors and @/lib/registrations. An endpoint that let a client post an
// arbitrary notification would make the feed forgeable.
//
// Scoping: tenantId comes from the session. `notification:read` is enforced in
// @/lib/notifications for both verbs — a caller holding it nowhere gets a 403,
// and a clinic-scoped Admin only ever sees, or flips, their own clinics' rows.

export async function GET(request: Request) {
  try {
    const actor = await requireActor();
    await requireModule(actor, MODULE_FEATURES.notifications);
    const params = new URL(request.url).searchParams;

    const filters = notificationFilterSchema.parse({
      status: params.get("status") ?? undefined,
      clinicId: params.get("clinicId") ?? undefined,
      limit: params.get("limit") ?? undefined,
    });

    return jsonOk(await listNotificationsForActor(actor, filters));
  } catch (error: unknown) {
    return toErrorResponse(error, "GET /api/notifications");
  }
}

export async function PATCH(request: Request) {
  try {
    const actor = await requireActor();
    await requireModule(actor, MODULE_FEATURES.notifications);
    const input = markNotificationsSchema.parse(await readJsonBody(request));

    // The result reports how many rows actually changed. An id the caller
    // cannot see updates nothing and still answers 200 — telling them "that
    // one isn't yours" would confirm it exists.
    return jsonOk(await markNotificationsForActor(actor, input));
  } catch (error: unknown) {
    return toErrorResponse(error, "PATCH /api/notifications");
  }
}
