import { describe, expect, it } from "vitest";
import { billingSettingsSchema, createServiceItemSchema, updateServiceItemSchema, serviceItemFiltersSchema } from "@/lib/billing/billingValidation";

const service = { name: "Consultation", category: "CONSULTATION", price: "100.00" };
describe("billing settings validation", () => {
  it("returns lazy defaults and nullable optional fields", () => {
    expect(billingSettingsSchema.parse({})).toEqual({ gstin: null, legalName: null, invoicePrefix: "INV", staffDiscountLimitPercent: "0.00", footerNote: null });
  });
  it("accepts valid GSTIN and boundary values", () => {
    expect(billingSettingsSchema.parse({ gstin: "27AAPFU0939F1ZV", invoicePrefix: "A1B2", staffDiscountLimitPercent: "100", legalName: "  Clinic  ", footerNote: "a".repeat(500) })).toMatchObject({ legalName: "Clinic", staffDiscountLimitPercent: "100.00" });
  });
  it.each(["", "abc", "ABCDE", "A-1", " INV"])("rejects invalid prefix %s", (invoicePrefix) => {
    expect(billingSettingsSchema.safeParse({ invoicePrefix }).success).toBe(false);
  });
  it.each([
    { gstin: "27AAPFU0939F1Z0" }, { gstin: "not-a-gstin" },
    { staffDiscountLimitPercent: "100.01" }, { staffDiscountLimitPercent: "-1" },
    { staffDiscountLimitPercent: "0.001" }, { footerNote: "x".repeat(501) }, { legalName: "x".repeat(201) },
    { tenantId: "foreign" }, { clinicId: "foreign" },
  ])("rejects invalid settings %j", (input) => expect(billingSettingsSchema.safeParse(input).success).toBe(false));
});
describe("service validation", () => {
  it("normalizes decimal strings without float arithmetic", () => {
    expect(createServiceItemSchema.parse({ ...service, name: "  Consultation  ", price: "1.2" })).toMatchObject({ name: "Consultation", price: "1.20", taxRatePercent: "0.00", clinicId: null, sacCode: null, isActive: true });
  });
  it.each(["0", "0.01", "99999999.99"])("accepts price boundary %s", (price) => expect(createServiceItemSchema.safeParse({ ...service, price }).success).toBe(true));
  it.each([undefined, 100, "", "-1", "100000000", "1.001", "1e2", "NaN", "Infinity", "1,000"])("rejects price %s without inventing a default", (price) => expect(createServiceItemSchema.safeParse({ ...service, price }).success).toBe(false));
  it.each([
    { name: " " }, { name: "a".repeat(121) }, { category: "MEDICINE" }, { taxRatePercent: "40.01" },
    { taxRatePercent: "0.001" }, { sacCode: "123456789" }, { sacCode: "12A" },
    { tenantId: "spoof" }, { status: "ISSUED" }, { grandTotal: "0.00" }, { clinicId: " " },
  ])("rejects invalid service fields %j", (patch) => expect(createServiceItemSchema.safeParse({ ...service, ...patch }).success).toBe(false));
  it("accepts the tax and SAC upper boundaries", () => expect(createServiceItemSchema.parse({ ...service, taxRatePercent: "40", sacCode: "12345678" })).toMatchObject({ taxRatePercent: "40.00", sacCode: "12345678" }));
  it("PATCH only changes supplied fields, preserving scope, price, tax and active state", () => {
    expect(updateServiceItemSchema.parse({ isActive: false })).toEqual({ isActive: false });
    expect(updateServiceItemSchema.parse({ name: "Revised" })).toEqual({ name: "Revised" });
    expect(updateServiceItemSchema.parse({ sacCode: "" })).toEqual({ sacCode: null });
    expect(updateServiceItemSchema.safeParse({}).success).toBe(false);
    expect(updateServiceItemSchema.safeParse({ tenantId: "spoof" }).success).toBe(false);
  });
  it("parses explicit inactive filters and rejects unknown query keys", () => {
    expect(serviceItemFiltersSchema.parse({ includeInactive: "false" }).includeInactive).toBe(false);
    expect(serviceItemFiltersSchema.parse({ includeInactive: "true" }).includeInactive).toBe(true);
    expect(serviceItemFiltersSchema.safeParse({ includeInactive: "1" }).success).toBe(false);
    expect(serviceItemFiltersSchema.safeParse({ tenantId: "spoof" }).success).toBe(false);
  });
});
