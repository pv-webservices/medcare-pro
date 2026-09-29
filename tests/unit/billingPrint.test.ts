import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import InvoiceDocument, { type InvoicePrintout } from "@/components/billing/InvoiceDocument";
import type { InvoiceSnapshot } from "@/lib/billing/invoiceValidation";

function snapshot(grandTotal: string, overrides: Partial<InvoiceSnapshot> = {}): InvoiceSnapshot {
  return {
    clinic: { name: "Synthetic Clinic", legalName: null, address: "1 Test Road", city: "Pune", logoUrl: null, gstin: "27AAPFU0939F1ZV", footerNote: "Synthetic footer" },
    patient: { patientCode: "PT-2026-0001", name: "Synthetic Patient", age: 40, gender: "Female", mobileNumber: "9000000000", city: "Pune" },
    doctor: { name: "Dr. Synthetic", department: "General" },
    visit: { date: "2026-09-28T10:00:00.000Z", type: "NEW" },
    lines: [{ position: 0, serviceItemId: null, description: "Consultation", category: "CONSULTATION", quantity: 1, unitPrice: grandTotal,
      discountAmount: "0.00", taxRatePercent: "0.00", sacCode: null, taxableAmount: grandTotal, taxAmount: "0.00", lineTotal: grandTotal }],
    totals: { subtotal: grandTotal, discountTotal: "0.00", taxableTotal: grandTotal, cgstTotal: "0.00", sgstTotal: "0.00", grandTotal },
    invoiceNumber: "INV-2627-00001",
    documentType: "BILL_OF_SUPPLY",
    issuedAt: "2026-09-28T10:30:00.000Z",
    ...overrides,
  };
}
const printout = (overrides: Partial<InvoicePrintout> = {}): InvoicePrintout => ({
  payments: [{ id: "p1", receivedAt: "2026-09-28T11:00:00.000Z", mode: "UPI", reference: "UTR-1", amount: "400.00" }],
  amountPaid: "400.00", balanceDue: "120100.50", asOf: "2026-09-29T06:30:00.000Z", cancellation: null, ...overrides,
});
const render = (snap: InvoiceSnapshot, print?: InvoicePrintout) => renderToStaticMarkup(createElement(InvoiceDocument, { snapshot: snap, printout: print }));

describe("invoice print document", () => {
  it("prints the grand total in Indian-numbering words", () => {
    const html = render(snapshot("120500.50"), printout());
    expect(html).toContain("Rupees One Lakh Twenty Thousand Five Hundred and Paise Fifty Only");
  });

  it("prints whole rupees and a zero total in words", () => {
    expect(render(snapshot("120000.00"), printout())).toContain("Rupees One Lakh Twenty Thousand Only");
    expect(render(snapshot("0.00"), printout({ payments: [], amountPaid: "0.00", balanceDue: "0.00" }))).toContain("Rupees Zero Only");
  });

  it("prints the document title, GSTIN, payments as of print time, balance and the computer-generated line", () => {
    const html = render(snapshot("120500.50"), printout());
    expect(html).toContain("Bill of Supply");
    expect(html).toContain("GSTIN: 27AAPFU0939F1ZV");
    expect(html).toContain("Payments as of 29 Sept 2026, 12:00 pm IST");
    expect(html).toContain("UTR-1");
    expect(html).toContain("₹1,20,100.50");
    expect(html).toContain("This is a computer-generated document.");
    expect(html).not.toContain("CANCELLED");
  });

  it("watermarks a cancelled bill with its reason and no balance", () => {
    const html = render(snapshot("500.00"), printout({ payments: [], amountPaid: "0.00", balanceDue: null,
      cancellation: { at: "2026-09-29T05:00:00.000Z", reason: "Synthetic wrong service" } }));
    expect(html).toContain('class="invoice-watermark"');
    expect(html).toContain("CANCELLED on");
    expect(html).toContain("Reason: Synthetic wrong service");
    expect(html).toContain("— (cancelled)");
    expect(html).toContain("No payments recorded.");
  });

  it("keeps the on-screen detail free of the print-only blocks", () => {
    const html = render(snapshot("500.00"));
    expect(html).toContain("Rupees Five Hundred Only");
    expect(html).not.toContain("Payments as of");
    expect(html).not.toContain("computer-generated");
  });
});
