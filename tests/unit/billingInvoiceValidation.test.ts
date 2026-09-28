import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/session", () => ({ UnauthenticatedError: class extends Error {} }));
import { ZodError } from "zod";
import { saveInvoiceSchema, invoiceFiltersSchema, issueInvoiceSchema, emptyInvoiceBodySchema } from "@/lib/billing/invoiceValidation";
import { billingErrorResponse } from "@/lib/billing/billingApi";
import { discountAmountForPercent, exceedsDiscountLimit } from "@/lib/billing/invoiceMath";

const line = { description: "Consultation", category: "CONSULTATION", quantity: 1, unitPrice: "100.00", discountAmount: "0.00", taxRatePercent: "0.00" };
describe("invoice boundaries", () => {
  it("converts percentage discounts in paise with half-up rounding", () => {
    expect(discountAmountForPercent(1, "0.01", "50")).toBe("0.01");
    expect(discountAmountForPercent(999, "99999.99", "100")).toBe("99899990.01");
    expect(() => discountAmountForPercent(1, "100.00", "100.01")).toThrow(RangeError);
  });
  it("enforces the exact discount ratio rather than rounding it down", () => {
    expect(exceedsDiscountLimit("1.00", "3.00", "33.33")).toBe(true);
    expect(exceedsDiscountLimit("25.00", "200.00", "12.50")).toBe(false);
    expect(exceedsDiscountLimit("0.00", "0.00", "0.00")).toBe(false);
  });
  it.each([
    { quantity: 1000 }, { quantity: 0 }, { quantity: 1.5 }, { discountAmount: "100.01" },
    { unitPrice: "99999999.99", quantity: 2 }, { unitPrice: "99999999.99", taxRatePercent: "40" },
    { unitPrice: "100000000" }, { unitPrice: "NaN" }, { unitPrice: "-1" }, { unitPrice: "1.001" },
    { taxRatePercent: "40.01" }, { description: " " }, { category: "MEDICINE" }, { sacCode: "12X" },
  ])("turns invalid input into a private validation response: %j", async (patch) => {
    let failure: unknown;
    try { saveInvoiceSchema.parse({ revision: 0, lines: [{ ...line, ...patch }] }); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(ZodError);
    const response = billingErrorResponse(failure, "invoice validation test");
    expect([400, 422]).toContain(response.status);
    expect(response.headers.get("cache-control")).toContain("private, no-store");
  });
  it("validates aggregate overflow even when each line fits", () => {
    expect(saveInvoiceSchema.safeParse({ revision: 1, lines: [{ ...line, unitPrice: "99999999.99" }, line] }).success).toBe(false);
  });
  it("allows empty drafts, zero totals, and full discounts", () => {
    expect(saveInvoiceSchema.parse({ revision: 0, lines: [] }).lines).toEqual([]);
    expect(saveInvoiceSchema.parse({ revision: 0, lines: [{ ...line, discountAmount: "100" }] }).lines[0].discountAmount).toBe("100.00");
  });
  it.each(["tenantId", "clinicId", "patientId", "doctorId", "status", "snapshot", "invoiceNumber", "grandTotal"])("rejects server-owned %s", (key) => {
    expect(saveInvoiceSchema.safeParse({ revision: 0, lines: [line], [key]: "spoof" }).success).toBe(false);
    expect(emptyInvoiceBodySchema.safeParse({ [key]: "spoof" }).success).toBe(false);
    expect(issueInvoiceSchema.safeParse({ revision: 0, [key]: "spoof" }).success).toBe(false);
  });
  it("rejects invalid dates, reversed intervals, and invalid pagination", () => {
    for (const input of [{ from: "2026-02-30" }, { from: "2026-10-01", to: "2026-09-01" }, { page: "0" }, { tenantId: "spoof" }]) {
      expect(invoiceFiltersSchema.safeParse(input).success).toBe(false);
    }
  });
});
