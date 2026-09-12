import { describe, expect, it } from "vitest";
import { clinicCapacityRequestSchema } from "@/lib/clinicCapacityRequestSchema";

describe("clinic capacity request input", () => {
  it("accepts a positive additional-clinic request without payment reference", () => {
    expect(clinicCapacityRequestSchema.parse({ requestType: "ADDITIONAL_CLINIC", requestedQuantity: 1 })).toMatchObject({ requestedQuantity: 1 });
  });

  it.each([0, -1, 1.5, 101])("rejects invalid requested quantity %s", (requestedQuantity) => {
    expect(clinicCapacityRequestSchema.safeParse({ requestType: "ADDITIONAL_CLINIC", requestedQuantity }).success).toBe(false);
  });

  it("requires a plan id only for an upgrade", () => {
    expect(clinicCapacityRequestSchema.safeParse({ requestType: "PLAN_UPGRADE" }).success).toBe(false);
    expect(clinicCapacityRequestSchema.safeParse({ requestType: "PLAN_UPGRADE", requestedPlanId: "plan-growth" }).success).toBe(true);
    expect(clinicCapacityRequestSchema.safeParse({ requestType: "PLAN_UPGRADE", requestedPlanId: "plan-growth", requestedQuantity: 1 }).success).toBe(false);
    expect(clinicCapacityRequestSchema.safeParse({ requestType: "PLAN_UPGRADE", requestedPlanId: "plan-growth", paymentReference: "ref" }).success).toBe(false);
  });

  it("rejects tenant and payment-status authority fields", () => {
    expect(clinicCapacityRequestSchema.safeParse({ requestType: "ADDITIONAL_CLINIC", requestedQuantity: 1, tenantId: "spoof", paymentStatus: "CONFIRMED" }).success).toBe(false);
  });
});
