import { describe, expect, it } from "vitest";
import { billingReasonSchema, duesFiltersSchema, recordPaymentSchema } from "@/lib/billing/invoiceValidation";
import { daysSinceIssue, duesAgeBucket, issuedAtRangeForBucket } from "@/lib/billing/duesAge";
import { duesCsvFilename, toDuesCsv } from "@/lib/billing/duesCsv";
import type { DueRecord } from "@/lib/billing/dues";
import { PAYMENT_STATUS_LABELS } from "@/lib/billing/billingLabels";

describe("payment validation", () => {
  it("accepts a positive exact amount and normalises it", () => {
    expect(recordPaymentSchema.parse({ amount: "12.5", mode: "UPI", reference: " UTR123 " })).toEqual({ amount: "12.50", mode: "UPI", reference: "UTR123" });
    expect(recordPaymentSchema.parse({ amount: "1", mode: "CASH" }).reference).toBeNull();
    expect(recordPaymentSchema.parse({ amount: "1", mode: "CASH", reference: "" }).reference).toBeNull();
  });
  it.each(["0", "0.00", "-1", "1.001", "1e2", "100000000.00"])("rejects amount %s", (amount) => {
    expect(recordPaymentSchema.safeParse({ amount, mode: "CASH" }).success).toBe(false);
  });
  it("rejects unknown modes, long references, extra keys and zone-less times", () => {
    expect(recordPaymentSchema.safeParse({ amount: "1", mode: "CHEQUE" }).success).toBe(false);
    expect(recordPaymentSchema.safeParse({ amount: "1", mode: "CASH", reference: "x".repeat(101) }).success).toBe(false);
    expect(recordPaymentSchema.safeParse({ amount: "1", mode: "CASH", invoiceId: "other" }).success).toBe(false);
    expect(recordPaymentSchema.safeParse({ amount: "1", mode: "CASH", receivedAt: "2026-09-29T10:00" }).success).toBe(false);
    expect(recordPaymentSchema.safeParse({ amount: "1", mode: "CASH", receivedAt: "2026-09-29T10:00:00+05:30" }).success).toBe(true);
  });
  it("requires a 3-500 character trimmed reason", () => {
    expect(billingReasonSchema.safeParse({ reason: "  ab  " }).success).toBe(false);
    expect(billingReasonSchema.parse({ reason: " Wrong mode " }).reason).toBe("Wrong mode");
    expect(billingReasonSchema.safeParse({ reason: "x".repeat(501) }).success).toBe(false);
    expect(billingReasonSchema.safeParse({}).success).toBe(false);
  });
  it("parses strict dues filters", () => {
    expect(duesFiltersSchema.parse({ age: "8-30", page: "2" })).toMatchObject({ age: "8-30", page: 2 });
    expect(duesFiltersSchema.safeParse({ age: "9-30" }).success).toBe(false);
    expect(duesFiltersSchema.safeParse({ tenantId: "x" }).success).toBe(false);
  });
});

describe("dues ageing in India time", () => {
  const now = new Date("2026-09-29T06:00:00Z"); // 11:30 IST on 29 Sep
  it("counts India calendar days, not 24-hour spans", () => {
    expect(daysSinceIssue(new Date("2026-09-28T18:30:00Z"), now)).toBe(0); // 00:00 IST 29 Sep
    expect(daysSinceIssue(new Date("2026-09-28T18:29:59Z"), now)).toBe(1); // 23:59 IST 28 Sep
    expect(daysSinceIssue(new Date("2026-09-30T00:00:00Z"), now)).toBe(0);
  });
  it.each([[0, "0-7"], [7, "0-7"], [8, "8-30"], [30, "8-30"], [31, "31+"], [400, "31+"]] as const)("day %i is bucket %s", (days, bucket) => {
    expect(duesAgeBucket(days)).toBe(bucket);
  });
  it("bucket ranges agree with the per-row bucket at every boundary", () => {
    for (const days of [6, 7, 8, 29, 30, 31]) {
      for (const [hour, minute] of [[0, 0], [23, 59]]) {
        const issued = new Date(Date.UTC(2026, 8, 29 - days, hour, minute) - 19_800_000);
        const bucket = duesAgeBucket(daysSinceIssue(issued, now));
        const range = issuedAtRangeForBucket(bucket, now);
        expect(days).toBe(daysSinceIssue(issued, now));
        expect(!range.gte || issued >= range.gte).toBe(true);
        expect(!range.lt || issued < range.lt).toBe(true);
      }
    }
    expect(issuedAtRangeForBucket("0-7", now).gte?.toISOString()).toBe("2026-09-21T18:30:00.000Z");
    expect(issuedAtRangeForBucket("31+", now).lt?.toISOString()).toBe("2026-08-29T18:30:00.000Z");
  });
});

describe("dues CSV", () => {
  const due: DueRecord = { id: "i1", invoiceNumber: "INV-2627-00001", issuedAt: "2026-09-28T18:45:00.000Z", ageDays: 0, ageBucket: "0-7",
    patientName: "=Synthetic", patientCode: "PT-2026-0001", mobileNumber: "9000000000", clinicName: "Clinic, A", doctorName: null,
    paymentStatus: "PARTIAL", grandTotal: "1180.00", amountPaid: "180.00", balanceDue: "1000.00" };
  it("writes unformatted money under INR headers, IST times and guards formulas", () => {
    const csv = toDuesCsv([due]);
    expect(csv.split("\r\n")[0]).toContain("Balance due (INR)");
    expect(csv).toContain("2026-09-29 00:15");
    expect(csv).toContain(",1000.00\r\n");
    expect(csv).not.toContain("₹");
    expect(csv).toContain('"Clinic, A"');
    expect(csv).not.toContain(",=Synthetic");
  });
  it("dates the filename in India time", () => {
    expect(duesCsvFilename(new Date("2026-09-28T19:00:00Z"))).toBe("dues-2026-09-29.csv");
  });
});

it("uses front-desk payment status wording", () => {
  expect(PAYMENT_STATUS_LABELS).toEqual({ UNPAID: "Unpaid", PARTIAL: "Partly paid", PAID: "Paid" });
});
