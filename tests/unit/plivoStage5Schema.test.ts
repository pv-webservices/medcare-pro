import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const schema = readFileSync(join(root, "prisma/schema.prisma"), "utf8");
const migration = readFileSync(
  join(root, "prisma/migrations/20260831120000_plivo_stage5_booking/migration.sql"),
  "utf8",
);
const staffWrapper = readFileSync(join(root, "src/lib/appointments.ts"), "utf8");
const bookingCore = readFileSync(join(root, "src/lib/appointmentBooking.ts"), "utf8");

describe("Plivo Stage 5 schema and architecture", () => {
  it("adds only the current appointment provenance values and a nullable user actor", () => {
    expect(schema).toMatch(/enum AppointmentBookingSource\s*{\s*STAFF\s*PHONE_IVR\s*}/);
    expect(schema).toMatch(/bookedById\s+String\?/);
    expect(schema).toContain("@@unique([bookingSource, bookingSourceRef])");
  });

  it("migrates existing appointments to STAFF without rewriting attribution", () => {
    expect(migration).toContain("NOT NULL DEFAULT 'STAFF'");
    expect(migration).not.toMatch(/UPDATE\s+`?appointments`?/i);
    expect(migration).toContain("appointments_booking_provenance_check");
  });

  it("gives callback requests a scoped database idempotency backstop", () => {
    expect(schema).toContain("@@unique([clinicId, provider, providerCallId])");
    expect(schema).toContain("@@index([tenantId, clinicId, status])");
  });

  it("builds an opaque clinic-scoped source reference without raw CallUUID", () => {
    expect(bookingCore).toContain('createHash("sha256")');
    expect(bookingCore).toContain('.update(clinicId)');
    expect(bookingCore).toContain('.update(callUuid)');
    expect(bookingCore).toContain('return `plivo:${digest}`');
  });

  it("keeps staff authorization as a wrapper over the single booking core", () => {
    expect(staffWrapper).toContain('requirePermission(actor, "appointment:create"');
    expect(staffWrapper).toContain("createAppointmentForScope({");
    expect(staffWrapper).not.toContain("INSERT INTO doctor_schedule_locks");
    expect(bookingCore).toContain("takeDoctorDayLocks");
    expect(bookingCore).toContain("appointmentTransaction");
    expect(bookingCore).not.toContain("prisma.patient.create");
    expect(bookingCore).not.toContain("prisma.registration.create");
  });
});
