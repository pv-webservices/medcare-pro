import { describe, expect, it } from "vitest";
import { normalizeClinicBusinessHours } from "@/lib/telephony/businessHoursContract";
import {
  deriveClinicPhoneReadiness,
  type PhoneReadinessInput,
} from "@/lib/telephony/phoneReadiness";

const NOW = new Date("2026-09-07T06:00:00.000Z");
const HOURS = normalizeClinicBusinessHours([
  {
    dayOfWeek: "MONDAY",
    isClosed: false,
    openTime: "09:00",
    closeTime: "17:00",
  },
]);

const BASE: PhoneReadinessInput = {
  enabled: true,
  providerNumber: "+919000000001",
  routingMode: "AUTO",
  publicPhoneNumber: "+919000000002",
  receptionPhoneNumber: "+919000000003",
  urgentPhoneNumber: "+919000000004",
  timezone: "Asia/Kolkata",
  hours: HOURS,
  phoneMenuSource: "default",
  urgentActionEnabled: true,
  now: NOW,
};

describe("clinic phone readiness", () => {
  it("reports a provisioned, enabled and fully safe clinic as ready", () => {
    expect(deriveClinicPhoneReadiness(BASE)).toMatchObject({
      serviceStatus: "active",
      effectiveRoute: "RECEPTION",
      readiness: {
        status: "ready",
        phoneService: { status: "ready" },
        automaticHours: { status: "ready" },
        reception: { status: "ready" },
        urgentTransfer: { status: "ready" },
        phoneMenu: { label: "Default phone menu" },
      },
    });
  });

  it("distinguishes not provisioned from a hard-disabled assigned service", () => {
    expect(
      deriveClinicPhoneReadiness({ ...BASE, providerNumber: null, enabled: false }),
    ).toMatchObject({ serviceStatus: "not-provisioned", readiness: { status: "inactive" } });
    expect(
      deriveClinicPhoneReadiness({ ...BASE, enabled: false }),
    ).toMatchObject({ serviceStatus: "disabled", readiness: { status: "inactive" } });
  });

  it("flags AUTO with no regular hours without changing the route mode", () => {
    const result = deriveClinicPhoneReadiness({ ...BASE, hours: [] });
    expect(result.readiness.automaticHours).toMatchObject({ status: "attention" });
    expect(result.effectiveRoute).toBe("IVR");
  });

  it("does not make missing hours critical outside AUTO", () => {
    expect(
      deriveClinicPhoneReadiness({
        ...BASE,
        routingMode: "AFTER_HOURS",
        hours: [],
      }).readiness.automaticHours.status,
    ).toBe("ready");
  });

  it("evaluates AUTO hours in the configured clinic timezone", () => {
    expect(deriveClinicPhoneReadiness(BASE).effectiveRoute).toBe("RECEPTION");
    expect(
      deriveClinicPhoneReadiness({
        ...BASE,
        timezone: "America/New_York",
      }).effectiveRoute,
    ).toBe("IVR");
  });

  it("uses the runtime-equivalent reception loop rule", () => {
    const result = deriveClinicPhoneReadiness({
      ...BASE,
      receptionPhoneNumber: BASE.providerNumber,
    });
    expect(result.readiness.reception).toMatchObject({ status: "attention" });
    expect(result.effectiveRoute).toBe("IVR");
    expect(JSON.stringify(result)).not.toContain(BASE.providerNumber);
  });

  it("does not block readiness for a missing urgent number when the action is disabled", () => {
    const result = deriveClinicPhoneReadiness({
      ...BASE,
      urgentActionEnabled: false,
      urgentPhoneNumber: null,
    });
    expect(result.readiness.urgentTransfer).toMatchObject({ status: "ready" });
  });

  it("flags a missing urgent destination only when urgent assistance is enabled", () => {
    expect(
      deriveClinicPhoneReadiness({ ...BASE, urgentPhoneNumber: null }).readiness
        .urgentTransfer.status,
    ).toBe("attention");
  });

  it("identifies a custom phone menu without exposing its content", () => {
    const result = deriveClinicPhoneReadiness({
      ...BASE,
      phoneMenuSource: "custom",
    });
    expect(result.readiness.phoneMenu.label).toBe("Custom phone menu");
    expect(result.readiness.phoneMenu).not.toHaveProperty("greetingTemplate");
  });
});
