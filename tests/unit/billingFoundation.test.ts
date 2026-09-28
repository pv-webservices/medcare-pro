import { describe, expect, it } from "vitest";
import { computeLine, computeTotals, derivePaymentStatus, discountPercent, fromPaise, toPaise } from "@/lib/billing/invoiceMath";
import { financialYearFor } from "@/lib/billing/financialYear";
import { formatInvoiceNumber } from "@/lib/billing/invoiceNumber";
import { amountInWords } from "@/lib/billing/amountInWords";
import { isValidGstin } from "@/lib/billing/gstin";
import { planBillingRoleMigration, PRE_BILLING_ROLE_PERMISSIONS, BILLING_ROLE_TOP_UPS } from "@/lib/billingRoleMigration";
import { DEFAULT_ROLES } from "@/lib/defaultRoles";
import { BILLING_PERMISSIONS, STAGE_1_PERMISSIONS, PRE_STAGE_11_PERMISSIONS, PRE_APPOINTMENTS_PERMISSIONS, findPermission } from "@/lib/permissions";
import { DEFAULT_FEATURES } from "@/lib/defaultFeatures";
import { MODULE_FEATURES } from "@/lib/moduleFeatures";

const line = (unitPrice = "100.00", taxRatePercent = "0.00", discountAmount = "0.00", quantity = 1) =>
  computeLine({ unitPrice, taxRatePercent, discountAmount, quantity });

describe("billing arithmetic", () => {
  it("converts decimal strings without floating point money", () => {
    expect(toPaise("0.29")).toBe(29);
    expect(toPaise("12.3")).toBe(1230);
    expect(fromPaise(29)).toBe("0.29");
    expect(fromPaise(toPaise("99999999.99"))).toBe("99999999.99");
  });
  it.each(["-1.00", "1.001", "1e3", "NaN", "Infinity", "100000000.00", " 1.00", ""])("rejects invalid money %s", (value) => {
    expect(() => toPaise(value)).toThrow();
  });
  it("rounds half up per line and allocates odd paise to SGST", () => {
    expect(line("0.05", "10.00")).toMatchObject({ tax: 1, cgst: 0, sgst: 1, lineTotal: 6 });
    expect(line("0.04", "10.00").tax).toBe(0);
    expect(computeTotals([line("0.05", "10.00"), line("0.05", "10.00")])).toEqual({ subtotal: 10, discountTotal: 0, taxableTotal: 10, cgstTotal: 0, sgstTotal: 2, grandTotal: 12 });
  });
  it("applies discount before tax, including full discount", () => {
    expect(line("100.00", "18.00", "25.00")).toMatchObject({ gross: 10000, taxable: 7500, tax: 1350, lineTotal: 8850 });
    expect(line("100.00", "18.00", "100.00").lineTotal).toBe(0);
    expect(() => line("1.00", "0", "1.01")).toThrow();
  });
  it("handles 999 times 99,999.99 and refuses DB overflow", () => {
    expect(line("99999.99", "0", "0", 999).gross).toBe(9989999001);
    expect(() => line("99999999.99", "40")).toThrow();
    expect(() => computeTotals([line("99999999.99"), line("0.01")])).toThrow();
  });
  it.each([0, 1000, 1.5, NaN])("rejects quantity %s", (quantity) => {
    expect(() => line("1", "0", "0", quantity)).toThrow();
  });
  it("rejects rates over 40 and unsafe paise", () => {
    expect(() => line("1", "40.01")).toThrow();
    expect(() => fromPaise(0.5)).toThrow();
    expect(() => fromPaise(Number.MAX_SAFE_INTEGER + 1)).toThrow();
  });
  it("handles percentages and zero subtotal", () => {
    expect(discountPercent(0, 0)).toBe("0.00");
    expect(discountPercent(1, 3)).toBe("33.33");
    expect(discountPercent(1, 32)).toBe("3.13");
    expect(discountPercent(100, 100)).toBe("100.00");
    expect(() => discountPercent(1, 0)).toThrow();
    expect(computeTotals([]).grandTotal).toBe(0);
  });
  it("derives zero, unpaid, partial and paid statuses", () => {
    expect(derivePaymentStatus(0, 0)).toBe("PAID");
    expect(derivePaymentStatus(100, 0)).toBe("UNPAID");
    expect(derivePaymentStatus(100, 1)).toBe("PARTIAL");
    expect(derivePaymentStatus(100, 100)).toBe("PAID");
    expect(() => derivePaymentStatus(100, 101)).toThrow();
  });
});

describe("billing formatting", () => {
  it.each([
    ["2026-03-31T23:59:00+05:30", "2526"],
    ["2026-04-01T00:00:00+05:30", "2627"],
    ["2026-03-31T18:30:00Z", "2627"],
  ])("uses IST at the FY boundary %s", (instant, fy) => expect(financialYearFor(new Date(instant))).toBe(fy));
  it("rejects an invalid date", () => expect(() => financialYearFor(new Date("invalid"))).toThrow());
  it("formats numbers within 16 characters", () => {
    expect(formatInvoiceNumber("INV", "2627", 1)).toBe("INV-2627-00001");
    expect(formatInvoiceNumber("AB12", "2627", 99999).length).toBeLessThanOrEqual(16);
    for (const seq of [0, 100000, -1, 1.5]) expect(() => formatInvoiceNumber("INV", "2627", seq)).toThrow();
    expect(() => formatInvoiceNumber("abc", "2627", 1)).toThrow();
    expect(() => formatInvoiceNumber("ABCDE", "2627", 1)).toThrow();
    expect(() => formatInvoiceNumber("INV", "2026", 1)).not.toThrow();
  });
  it.each([
    ["0.00", "Rupees Zero Only"],
    ["0.50", "Rupees Zero and Paise Fifty Only"],
    ["120500.50", "Rupees One Lakh Twenty Thousand Five Hundred and Paise Fifty Only"],
    ["10000000.00", "Rupees One Crore Only"],
    ["99999999.99", "Rupees Nine Crore Ninety Nine Lakh Ninety Nine Thousand Nine Hundred Ninety Nine and Paise Ninety Nine Only"],
  ])("spells %s in Indian numbering", (value, expected) => expect(amountInWords(value)).toBe(expected));
  it("checks GSTIN format, allowed state code and checksum", () => {
    expect(isValidGstin("27AAPFU0939F1ZV")).toBe(true);
    expect(isValidGstin("29AAACB2894G1ZJ")).toBe(true);
    for (const invalid of ["27AAPFU0939F1Z0", "00AAPFU0939F1ZV", "39AAPFU0939F1ZV", "27aapfu0939f1zv", "27AAPFU0939F0ZV", "27AAPFU0939F1YV", "", "27AAPFU0939F1ZVV"])
      expect(isValidGstin(invalid)).toBe(false);
  });
});

describe("billing catalogue and role migration", () => {
  it("keeps billing out of historical permission stages", () => {
    expect(STAGE_1_PERMISSIONS).toHaveLength(12);
    for (const list of [STAGE_1_PERMISSIONS, PRE_STAGE_11_PERMISSIONS, PRE_APPOINTMENTS_PERMISSIONS]) {
      for (const key of BILLING_PERMISSIONS) expect(list).not.toContain(key);
    }
  });
  it("registers a pending catalogue and CORE default feature", () => {
    expect(BILLING_PERMISSIONS).toHaveLength(6);
    const expectedPending = {
      "invoice:read": undefined,
      "billing:settings:manage": undefined,
      "invoice:create": undefined,
      "payment:record": undefined,
      "invoice:discount:override": undefined,
      "invoice:cancel": undefined,
    } as const;
    for (const [key, pending] of Object.entries(expectedPending)) {
      expect(findPermission(key)).toBeDefined();
      expect(findPermission(key)?.pending).toBe(pending);
      expect(findPermission(key)?.pendingNote).toBe(
        pending === undefined ? undefined : "Enforced from PB-2/PB-3",
      );
    }
    expect(DEFAULT_FEATURES.find((f) => f.key === MODULE_FEATURES.billing)).toMatchObject({ name: "Patient billing", tier: "CORE", globalEnabled: true, inDefaultPlan: true });
  });
  it.each(Object.keys(PRE_BILLING_ROLE_PERMISSIONS))("only tops up the exact system snapshot for %s", (key) => {
    const before = PRE_BILLING_ROLE_PERMISSIONS[key];
    const role = { key, isSystem: true, permissions: before };
    expect(planBillingRoleMigration(role)).toEqual({ status: "ELIGIBLE", additions: BILLING_ROLE_TOP_UPS[key] });
    expect(DEFAULT_ROLES.find((r) => r.key === key)!.permissions).toEqual([...before, ...BILLING_ROLE_TOP_UPS[key]]);
    expect(planBillingRoleMigration({ ...role, permissions: [...before].reverse() }).status).toBe("ELIGIBLE");
    expect(planBillingRoleMigration({ ...role, isSystem: false }).status).toBe("CUSTOMIZED_OR_OLDER");
    expect(planBillingRoleMigration({ ...role, permissions: before.slice(1) }).status).toBe("CUSTOMIZED_OR_OLDER");
    expect(planBillingRoleMigration({ ...role, permissions: [...before, "custom:permission"] }).status).toBe("CUSTOMIZED_OR_OLDER");
    expect(planBillingRoleMigration({ ...role, permissions: [...before, ...BILLING_ROLE_TOP_UPS[key]] }).status).toBe("ALREADY_CURRENT");
  });
  it("leaves owners, custom, malformed and partially upgraded roles alone", () => {
    expect(planBillingRoleMigration({ key: "OWNER", isSystem: true, permissions: ["*"] }).status).toBe("NOT_TARGETED");
    expect(planBillingRoleMigration({ key: null, isSystem: false, permissions: [] }).status).toBe("NOT_TARGETED");
    for (const permissions of [null, {}, [1], [...PRE_BILLING_ROLE_PERMISSIONS.RECEPTIONIST, "invoice:read"]]) {
      expect(planBillingRoleMigration({ key: "RECEPTIONIST", isSystem: true, permissions }).status).toBe("CUSTOMIZED_OR_OLDER");
    }
  });
});
