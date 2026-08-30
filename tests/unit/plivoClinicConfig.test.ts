import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({
  UnauthenticatedError: class UnauthenticatedError extends Error {},
}));
import { BadRequestError } from "@/lib/apiHandler";
import {
  resolveInboundClinicByPlivoNumber,
  updateClinicTelephonyConfigSchema,
  validateClinicTelephonyConfigState,
  type InboundClinicLookup,
} from "@/lib/telephony/clinicConfig";

const rows = new Map([
  [
    "+14155550101",
    { clinicId: "clinic-a", tenantId: "tenant-a", name: "Clinic A" },
  ],
  [
    "+14155550102",
    { clinicId: "clinic-b", tenantId: "tenant-a", name: "Clinic B" },
  ],
  [
    "+14155550103",
    { clinicId: "clinic-c", tenantId: "tenant-b", name: "Clinic C" },
  ],
]);

const lookup: InboundClinicLookup = async (number) => {
  const clinic = rows.get(number);
  return clinic
    ? {
        enabled: true,
        timezone: "Asia/Kolkata",
        publicPhoneNumber: null,
        receptionPhoneNumber: null,
        urgentPhoneNumber: null,
        clinic: {
          id: clinic.clinicId,
          tenantId: clinic.tenantId,
          name: clinic.name,
        },
      }
    : null;
};

function state(overrides: Record<string, unknown> = {}) {
  return {
    enabled: false,
    plivoNumber: "+14155550101",
    publicPhoneNumber: "+14155550110",
    receptionPhoneNumber: "+14155550111",
    urgentPhoneNumber: "+14155550112",
    timezone: "Asia/Kolkata",
    ...overrides,
  } as Parameters<typeof validateClinicTelephonyConfigState>[0];
}

describe("clinic telephony configuration", () => {
  it("normalizes valid configuration numbers and empty optional values", () => {
    expect(
      updateClinicTelephonyConfigSchema.parse({
        plivoNumber: "+14155550101",
        receptionPhoneNumber: "",
      }),
    ).toEqual({ plivoNumber: "+14155550101", receptionPhoneNumber: null });
  });

  it.each(["14155550101", "+123", "+1415ABC0101", "+14155550101x2"])(
    "rejects malformed or ambiguous configuration number %s",
    (plivoNumber) => {
      expect(() =>
        updateClinicTelephonyConfigSchema.parse({ plivoNumber }),
      ).toThrow();
    },
  );

  it("rejects enabling without a provider number", () => {
    expect(() =>
      validateClinicTelephonyConfigState(
        state({ enabled: true, plivoNumber: null }),
      ),
    ).toThrow(BadRequestError);
  });

  it.each([
    ["receptionPhoneNumber", "publicPhoneNumber"],
    ["urgentPhoneNumber", "publicPhoneNumber"],
    ["receptionPhoneNumber", "plivoNumber"],
    ["urgentPhoneNumber", "plivoNumber"],
  ] as const)("rejects %s matching %s", (target, source) => {
    const base = state();
    expect(() =>
      validateClinicTelephonyConfigState(state({ [target]: base[source] })),
    ).toThrow(BadRequestError);
  });

  it("allows reception and urgent numbers to match", () => {
    expect(() =>
      validateClinicTelephonyConfigState(
        state({ urgentPhoneNumber: "+14155550111" }),
      ),
    ).not.toThrow();
  });

  it("accepts valid IANA timezones and rejects invalid values", () => {
    expect(
      updateClinicTelephonyConfigSchema.parse({ timezone: "Europe/London" }),
    ).toEqual({ timezone: "Europe/London" });
    expect(() =>
      updateClinicTelephonyConfigSchema.parse({ timezone: "India/Nowhere" }),
    ).toThrow();
  });

  it("rejects request-controlled scope fields", () => {
    expect(() =>
      updateClinicTelephonyConfigSchema.parse({
        enabled: false,
        tenantId: "tenant-b",
      }),
    ).toThrow();
    expect(() =>
      updateClinicTelephonyConfigSchema.parse({
        enabled: false,
        clinicId: "clinic-b",
      }),
    ).toThrow();
  });
});

describe("inbound clinic resolution", () => {
  it.each([
    ["+14155550101", "clinic-a", "tenant-a"],
    ["+14155550102", "clinic-b", "tenant-a"],
    ["+14155550103", "clinic-c", "tenant-b"],
  ])("resolves %s only to %s", async (to, clinicId, tenantId) => {
    const result = await resolveInboundClinicByPlivoNumber(to, lookup);
    expect(result).toMatchObject({ clinicId, tenantId });
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("normalizes Plivo's country-coded digits-only To form", async () => {
    await expect(
      resolveInboundClinicByPlivoNumber("14155550101", lookup),
    ).resolves.toMatchObject({ clinicId: "clinic-a" });
  });

  it.each([undefined, null, "", "5550101", "+123", "unknown"])(
    "fails closed for missing or malformed To=%s",
    async (to) => {
      await expect(
        resolveInboundClinicByPlivoNumber(to, lookup),
      ).resolves.toBeNull();
    },
  );

  it("fails closed for unknown, disabled, and numberless configurations", async () => {
    await expect(
      resolveInboundClinicByPlivoNumber("+14155550999", lookup),
    ).resolves.toBeNull();
    await expect(
      resolveInboundClinicByPlivoNumber("+14155550101", async () => ({
        ...(await lookup("+14155550101"))!,
        enabled: false,
      })),
    ).resolves.toBeNull();
    const numberlessLookup: InboundClinicLookup = async () => null;
    await expect(
      resolveInboundClinicByPlivoNumber("+14155550104", numberlessLookup),
    ).resolves.toBeNull();
  });

  it("enforces both uniqueness guarantees in Prisma and SQL", () => {
    const schema = readFileSync(resolve("prisma/schema.prisma"), "utf8");
    const migration = readFileSync(
      resolve(
        "prisma/migrations/20260830180000_clinic_telephony_config/migration.sql",
      ),
      "utf8",
    );
    expect(schema).toMatch(/clinicId\s+String\s+@unique/);
    expect(schema).toMatch(/plivoNumber\s+String\?\s+@unique/);
    expect(migration).toContain("clinic_telephony_configs_clinic_id_key");
    expect(migration).toContain("clinic_telephony_configs_plivo_number_key");
  });
});
