import { describe, expect, it } from "vitest";
import {
  buildAppointmentReadScope,
  withinAppointmentReadScope,
} from "@/lib/appointmentScope";

const clinics = ["clinic-a", "clinic-b"];
const linked = [
  { id: "doctor-a", clinicId: "clinic-a" },
  { id: "doctor-a-b", clinicId: "clinic-b" },
];

function canSee(
  scope: ReturnType<typeof buildAppointmentReadScope>,
  clinicId: string,
  doctorId: string,
): boolean {
  return (
    scope.broadClinicIds.includes(clinicId) ||
    (scope.selfClinicIds.includes(clinicId) && scope.linkedDoctorIds.includes(doctorId))
  );
}

describe("central appointment read scope", () => {
  it("isolates two linked doctors inside the same clinic", () => {
    const scope = buildAppointmentReadScope({
      tenantId: "tenant",
      tenantClinicIds: clinics,
      broadScope: { scope: "none" },
      selfScope: { scope: "clinics", clinicIds: ["clinic-a"] },
      linkedDoctors: [linked[0]],
    });
    expect(scope.kind).toBe("doctor-self");
    expect(canSee(scope, "clinic-a", "doctor-a")).toBe(true);
    expect(canSee(scope, "clinic-a", "doctor-b")).toBe(false);
    expect(scope.where).toEqual({
      tenantId: "tenant",
      OR: [
        {
          clinicId: { in: ["clinic-a"] },
          doctorId: { in: ["doctor-a"] },
        },
      ],
    });
  });

  it("keeps guessed appointment and doctor ids inside the authoritative scope", () => {
    const scope = buildAppointmentReadScope({
      tenantId: "tenant",
      tenantClinicIds: clinics,
      broadScope: { scope: "none" },
      selfScope: { scope: "clinics", clinicIds: ["clinic-a"] },
      linkedDoctors: [linked[0]],
    });
    expect(
      withinAppointmentReadScope(scope, {
        id: "doctor-b-appointment",
        doctorId: "doctor-b",
      }),
    ).toEqual({
      AND: [
        scope.where,
        { id: "doctor-b-appointment", doctorId: "doctor-b" },
      ],
    });
  });

  it("supports one user linked to profiles in multiple clinics", () => {
    const scope = buildAppointmentReadScope({
      tenantId: "tenant",
      tenantClinicIds: clinics,
      broadScope: { scope: "none" },
      selfScope: { scope: "all" },
      linkedDoctors: linked,
    });
    expect(scope.linkedDoctorIds).toEqual(["doctor-a", "doctor-a-b"]);
    expect(canSee(scope, "clinic-b", "doctor-a-b")).toBe(true);
  });

  it("lets the clinic switcher narrow a multi-clinic doctor", () => {
    const scope = buildAppointmentReadScope({
      tenantId: "tenant",
      tenantClinicIds: clinics,
      requestedClinicId: "clinic-a",
      broadScope: { scope: "none" },
      selfScope: { scope: "all" },
      linkedDoctors: linked,
    });
    expect(scope.selfClinicIds).toEqual(["clinic-a"]);
    expect(scope.linkedDoctorIds).toEqual(["doctor-a"]);
    expect(canSee(scope, "clinic-b", "doctor-a-b")).toBe(false);
  });

  it("unions Doctor self scope at Clinic A with Admin broad scope at Clinic B", () => {
    const scope = buildAppointmentReadScope({
      tenantId: "tenant",
      tenantClinicIds: clinics,
      broadScope: { scope: "clinics", clinicIds: ["clinic-b"] },
      selfScope: { scope: "clinics", clinicIds: ["clinic-a"] },
      linkedDoctors: [linked[0]],
    });
    expect(scope.kind).toBe("mixed");
    expect(canSee(scope, "clinic-a", "doctor-a")).toBe(true);
    expect(canSee(scope, "clinic-a", "doctor-b")).toBe(false);
    expect(canSee(scope, "clinic-b", "any-doctor")).toBe(true);
  });

  it("keeps Admin and Receptionist clinic-wide visibility", () => {
    for (const broadScope of [
      { scope: "all" } as const,
      { scope: "clinics", clinicIds: ["clinic-a"] } as const,
    ]) {
      const scope = buildAppointmentReadScope({
        tenantId: "tenant",
        tenantClinicIds: clinics,
        broadScope,
        selfScope: { scope: "none" },
        linkedDoctors: [],
      });
      expect(canSee(scope, "clinic-a", "doctor-a")).toBe(true);
      expect(canSee(scope, "clinic-a", "doctor-b")).toBe(true);
    }
  });

  it("returns no appointment query for an unlinked self-only doctor", () => {
    const scope = buildAppointmentReadScope({
      tenantId: "tenant",
      tenantClinicIds: clinics,
      broadScope: { scope: "none" },
      selfScope: { scope: "clinics", clinicIds: ["clinic-a"] },
      linkedDoctors: [],
    });
    expect(scope.kind).toBe("doctor-self");
    expect(scope.where).toBeNull();
    expect(scope.unlinkedSelfClinicIds).toEqual(["clinic-a"]);
  });

  it("rejects client-selected and candidate clinics outside the tenant", () => {
    const scope = buildAppointmentReadScope({
      tenantId: "tenant",
      tenantClinicIds: clinics,
      candidateClinicIds: ["other-tenant"],
      requestedClinicId: "other-tenant",
      broadScope: { scope: "all" },
      selfScope: { scope: "all" },
      linkedDoctors: [...linked, { id: "other-doctor", clinicId: "other-tenant" }],
    });
    expect(scope.kind).toBe("unavailable");
    expect(scope.where).toBeNull();
  });
});
