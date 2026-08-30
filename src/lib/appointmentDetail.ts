import {
  getAppointmentForActor,
  toAppointmentStateView,
  type AppointmentStateView,
} from "@/lib/appointmentLifecycle";
import { prisma } from "@/lib/prisma";
import { ScopeError, type ActorContext } from "@/lib/rbac";

/**
 * One appointment, read for its own page — AP-6.
 *
 * A separate module from lib/appointments.ts because it answers a different
 * question. That file computes slots, books, and pages the board; this reads a
 * single row and the names hanging off it, which is what a detail screen needs
 * and what a list must never carry per row.
 *
 * SCOPE IS NOT RE-IMPLEMENTED HERE. `getAppointmentForActor` is AP-4's, and it
 * is what decides whether this caller may see the row at all — filtered by
 * tenant and by `appointment:read` clinic scope, refusing with a 404 that does
 * not confirm existence. This module only enriches what that returns, so there
 * is exactly one definition of "may this person see this appointment".
 */

export interface AppointmentDetailView extends AppointmentStateView {
  clinicName: string;
  doctorName: string;
  /** The doctor's department — what conversion will file the visit under. */
  doctorDepartment: string;
  appointmentTypeName: string;
  durationMinutes: number;

  // The appointment's own snapshot of who it is for. Present here and absent
  // from the board on purpose: a list of names and numbers on one screen is a
  // different disclosure from opening one person's booking.
  mobileNumber: string;
  age: number | null;
  gender: string | null;
  address: string | null;
  city: string | null;

  /** Set once this person is on the register — before that, null. */
  patientCode: string | null;

  /** ISO string for the creation timestamp */
  createdAt: string;
  bookedByName: string | null;
  checkedInByName: string | null;
  cancelledByName: string | null;

  /** The visit this became, if it has been converted. */
  registration: { id: string; patientCode: string } | null;
  /** The row this one replaced, and the row that replaced it. */
  rescheduledToId: string | null;
}

/** "Priya Sharma" from a user row, falling back to the address. */
function personName(
  person: { name: string | null; email: string } | null,
): string | null {
  if (!person) return null;
  return person.name?.trim() || person.email;
}

/**
 * Loads one appointment with everything its page shows, or throws ScopeError.
 *
 * Two queries rather than one: the first is AP-4's scoped read, which is the
 * authorisation; the second only widens what is already known to be visible. A
 * single hand-written query here would have meant a second copy of the scope
 * rules, and the whole point of the split is that there is not one.
 */
export async function getAppointmentDetailForActor(
  actor: ActorContext,
  appointmentId: string,
): Promise<AppointmentDetailView> {
  const scoped = await getAppointmentForActor(actor, appointmentId);

  const row = await prisma.appointment.findUnique({
    where: { id: scoped.id },
    select: {
      mobileNumber: true,
      age: true,
      gender: true,
      address: true,
      city: true,
      createdAt: true,
      clinic: { select: { name: true } },
      doctor: { select: { name: true, department: true } },
      appointmentType: { select: { name: true, durationMinutes: true } },
      patient: { select: { patientCode: true } },
      bookedBy: { select: { name: true, email: true } },
      checkedInBy: { select: { name: true, email: true } },
      cancelledBy: { select: { name: true, email: true } },
      registration: { select: { id: true, patient: { select: { patientCode: true } } } },
      rescheduledTo: { select: { id: true }, take: 1 },
    },
  });

  // Cannot normally happen — the row was read a moment ago, inside scope.
  // Refused rather than crashed, and as a 404 like every other miss here.
  if (!row) {
    throw new ScopeError();
  }

  return {
    ...toAppointmentStateView(scoped),
    clinicName: row.clinic.name,
    doctorName: row.doctor.name,
    doctorDepartment: row.doctor.department,
    appointmentTypeName: row.appointmentType.name,
    durationMinutes: row.appointmentType.durationMinutes,
    mobileNumber: row.mobileNumber,
    age: row.age,
    gender: row.gender,
    address: row.address,
    city: row.city,
    patientCode: row.patient?.patientCode ?? null,
    createdAt: row.createdAt.toISOString(),
    bookedByName: personName(row.bookedBy),
    checkedInByName: personName(row.checkedInBy),
    cancelledByName: personName(row.cancelledBy),
    registration: row.registration
      ? {
          id: row.registration.id,
          patientCode: row.registration.patient.patientCode,
        }
      : null,
    rescheduledToId: row.rescheduledTo[0]?.id ?? null,
  };
}
