import { jsonOk, readJsonBody, toErrorResponse } from "@/lib/apiHandler";
import {
  sendAppointmentReminder,
  sendAppointmentReminderSchema,
} from "@/lib/appointmentReminders";
import { MODULE_FEATURES, requireModule } from "@/lib/features";
import { requireActor } from "@/lib/session";

// Send an approved reminder about one appointment — AP-8.
//
// POST, not PATCH: this changes nothing about the appointment. It sends a
// message and writes a `whatsapp_messages` row, and the appointment's status,
// slot and occupancy are untouched — a reminder is not a lifecycle event, and
// nothing here may become one.
//
// TWO PERMISSIONS MEET ON THIS PATH, as they do on /api/appointment-types:
//
//   the scoped read needs `appointment:read`  — you cannot message about a
//                                               booking you cannot see.
//   the send needs `message:send` AT ITS CLINIC — messaging a patient is a
//                                               messaging permission, not an
//                                               appointment one. A role that
//                                               books all day does not thereby
//                                               get to text patients.
//
// The body carries a template id and nothing else. There is deliberately no
// free-text field: every outbound message in this app is an approved template,
// and adding a `message` key here would be the one endpoint that broke that.

interface RouteContext {
  // Next 16 hands route params to the handler as a promise.
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const actor = await requireActor();
    await requireModule(actor, MODULE_FEATURES.appointments);

    const { id } = await context.params;
    const input = sendAppointmentReminderSchema.parse(await readJsonBody(request));

    return jsonOk(await sendAppointmentReminder(actor, id, input));
  } catch (error: unknown) {
    return toErrorResponse(error, "POST /api/appointments/[id]/remind");
  }
}
