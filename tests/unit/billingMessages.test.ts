import { describe, expect, it } from "vitest";
import { BadRequestError, ConflictError } from "@/lib/domainErrors";
import { computeLine, derivePaymentStatus, discountAmountForPercent, discountPercent, toPaise } from "@/lib/billing/invoiceMath";
import { recordPaymentSchema, saveInvoiceSchema } from "@/lib/billing/invoiceValidation";
import {
  BILLING_MESSAGES,
  friendlyBillingError,
  friendlyBillingIssue,
  friendlyBillingMessage,
  lineFieldErrors,
  parseDiscountPercent,
} from "@/lib/billing/billingMessages";

/** Wording that must never reach a person. */
const RAW = /non-negative decimal|Invalid|Too small|Too big|Expected|must match pattern|exceeds gross|outside the supported range|RangeError|undefined|NaN/i;
const line = { serviceItemId: null, description: "Consultation", category: "CONSULTATION", quantity: 1, unitPrice: "500.00",
  discountAmount: "0.00", taxRatePercent: "0.00", sacCode: null };

describe("discount percent parser", () => {
  it.each([["10", "10"], ["12.5", "12.5"], ["12.50%", "12.50"], [" 15 % ", "15"], ["0", "0"], ["100", "100"], ["100%", "100"]])("accepts %j", (input, expected) => {
    expect(parseDiscountPercent(input)).toBe(expected);
  });
  it.each(["", "   ", "%", "abc", "10.123", "-5", "100.01", "150", "1e2", "10 percent", "5,5"])("rejects %j", (input) => {
    expect(parseDiscountPercent(input)).toBeNull();
  });
});

describe("inline line errors", () => {
  it("is empty for a valid line", () => {
    expect(lineFieldErrors(line)).toEqual({});
  });
  it("names each bad field in plain language", () => {
    expect(lineFieldErrors({ ...line, unitPrice: "abc" }).unitPrice).toBe("Enter a price like 500 or 499.50");
    expect(lineFieldErrors({ ...line, quantity: 0 }).quantity).toBe("Whole number from 1 to 999");
    expect(lineFieldErrors({ ...line, quantity: 1.5 }).quantity).toBe("Whole number from 1 to 999");
    expect(lineFieldErrors({ ...line, discountAmount: "600" }).discountAmount).toBe("Can't be more than the line amount");
    expect(lineFieldErrors({ ...line, discountAmount: "5x" }).discountAmount).toBe("Enter a discount like 50 or 49.50");
    expect(lineFieldErrors({ ...line, taxRatePercent: "41" }).taxRatePercent).toBe("Enter a GST rate between 0 and 40");
    expect(lineFieldErrors({ ...line, description: "  " }).description).toBe("Enter a description for this line");
  });
});

describe("server and client error mapping", () => {
  it("rewords schema issues per field, with the line number", () => {
    const result = saveInvoiceSchema.safeParse({ revision: 1, lines: [line, { ...line, unitPrice: "4.999" }] });
    expect(result.success).toBe(false);
    expect(friendlyBillingIssue(result.error!.issues[0])).toBe("Line 2: Enter a price like 500 or 499.50");
    const gst = saveInvoiceSchema.safeParse({ revision: 1, lines: [{ ...line, taxRatePercent: "50" }] });
    expect(friendlyBillingIssue(gst.error!.issues[0])).toBe("Line 1: Enter a GST rate between 0 and 40");
    const discount = saveInvoiceSchema.safeParse({ revision: 1, lines: [{ ...line, discountAmount: "600.00" }] });
    expect(friendlyBillingIssue(discount.error!.issues[0])).toBe("Can't be more than the line amount");
  });

  it("rewords money-rule errors and leaves messages written for people alone", () => {
    expect(friendlyBillingError(new BadRequestError("Discount exceeds gross amount"))).toBe(BILLING_MESSAGES.discountAmount);
    expect(friendlyBillingError(new RangeError("Expected a non-negative decimal amount with at most two decimals"))).toBe(BILLING_MESSAGES.amount);
    expect(friendlyBillingError(new BadRequestError("Set this clinic's GSTIN before issuing a bill with GST."))).toBeNull();
    expect(friendlyBillingError(new ConflictError("This visit already has a live bill."))).toBeNull();
    expect(friendlyBillingMessage("This draft changed in another session. Reload and review it.")).toBe("This draft changed in another session. Reload and review it.");
  });

  it("never shows raw schema or math wording for any bad input", () => {
    const shown: string[] = [];
    const badLines = [
      { unitPrice: "" }, { unitPrice: "abc" }, { unitPrice: "-5" }, { unitPrice: "1.234" }, { unitPrice: "123456789" },
      { quantity: 0 }, { quantity: 1000 }, { quantity: 2.5 }, { quantity: Number.NaN },
      { discountAmount: "" }, { discountAmount: "9999" }, { discountAmount: "x" },
      { taxRatePercent: "41" }, { taxRatePercent: "abc" }, { description: "" }, { sacCode: "12345678901" }, { category: "SURGERY" },
    ];
    for (const bad of badLines) {
      const result = saveInvoiceSchema.safeParse({ revision: 1, lines: [{ ...line, ...bad }] });
      expect(result.success).toBe(false);
      shown.push(friendlyBillingError(result.error)!);
      shown.push(...Object.values(lineFieldErrors({ ...line, ...bad } as typeof line)));
    }
    for (const amount of ["", "0", "abc", "1.001"]) {
      const result = recordPaymentSchema.safeParse({ amount, mode: "CASH" });
      if (!result.success) shown.push(friendlyBillingError(result.error)!);
    }
    const mathFailures: Array<() => unknown> = [
      () => toPaise("abc"), () => toPaise("99999999999"), () => computeLine({ quantity: 0, unitPrice: "1", discountAmount: "0", taxRatePercent: "0" }),
      () => computeLine({ quantity: 1, unitPrice: "1", discountAmount: "2", taxRatePercent: "0" }),
      () => computeLine({ quantity: 1, unitPrice: "1", discountAmount: "0", taxRatePercent: "41" }),
      () => discountAmountForPercent(1, "100", "101"), () => discountPercent(200, 100), () => derivePaymentStatus(100, 200),
    ];
    for (const fail of mathFailures) {
      try { fail(); throw new Error("expected a RangeError"); }
      catch (error) { expect(error).toBeInstanceOf(RangeError); shown.push(friendlyBillingError(error)!); }
    }
    expect(shown.length).toBeGreaterThan(30);
    for (const message of shown) {
      expect(message).toBeTruthy();
      expect(message).not.toMatch(RAW);
    }
  });
});
