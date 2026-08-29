import { describe, expect, it } from "vitest";
import { clinicIdsForDashboardScope } from "@/lib/adminDashboardScope";

const clinics = [
  { id: "clinic-a", name: "Clinic A" },
  { id: "clinic-b", name: "Clinic B" },
];

describe("admin dashboard clinic scope", () => {
  it("aggregates every tenant clinic for an account-wide permission", () => {
    expect(clinicIdsForDashboardScope({ scope: "all" }, clinics, null)).toEqual([
      "clinic-a",
      "clinic-b",
    ]);
  });

  it("limits a clinic-scoped permission to its assigned clinic", () => {
    expect(
      clinicIdsForDashboardScope(
        { scope: "clinics", clinicIds: ["clinic-a"] },
        clinics,
        null,
      ),
    ).toEqual(["clinic-a"]);
  });

  it("returns no data when a clinic-scoped user requests another clinic", () => {
    expect(
      clinicIdsForDashboardScope(
        { scope: "clinics", clinicIds: ["clinic-a"] },
        clinics,
        "clinic-b",
      ),
    ).toEqual([]);
  });

  it("cannot select a clinic outside the tenant even with account-wide access", () => {
    expect(
      clinicIdsForDashboardScope({ scope: "all" }, clinics, "other-tenant-clinic"),
    ).toEqual([]);
  });

  it("returns no clinics when the permission is absent", () => {
    expect(
      clinicIdsForDashboardScope({ scope: "none" }, clinics, null),
    ).toEqual([]);
  });

  it("returns no data for an empty permitted-clinic set", () => {
    expect(
      clinicIdsForDashboardScope({ scope: "clinics", clinicIds: [] }, clinics, null),
    ).toEqual([]);
  });
});
