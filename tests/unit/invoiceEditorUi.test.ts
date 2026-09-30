import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import InvoiceEditor from "@/components/billing/InvoiceEditor";
import type { InvoiceRecord } from "@/lib/billing/invoices";
import type { ServiceItemRecord } from "@/lib/billing/serviceItems";

const draft = {
  id: "inv-1", registrationId: "reg-1", clinicId: "clinic-1", status: "DRAFT", invoiceNumber: null, revision: 1,
  paymentStatus: "UNPAID", amountPaid: "0.00", balanceDue: "300.00",
  totals: { subtotal: "300.00", discountTotal: "0.00", taxableTotal: "300.00", cgstTotal: "0.00", sgstTotal: "0.00", grandTotal: "300.00" },
  lines: [{ position: 0, serviceItemId: null, description: "Consultation", category: "CONSULTATION", quantity: 1, unitPrice: "300.00",
    discountAmount: "0.00", taxRatePercent: "0.00", sacCode: null, taxableAmount: "300.00", taxAmount: "0.00", lineTotal: "300.00" }],
  snapshot: null, issuedAt: null, createdById: "user-1", cancelledAt: null, cancelReason: null, replacesInvoiceId: null,
} as unknown as InvoiceRecord;
const xray = { id: "svc-1", name: "X-ray", category: "TEST", price: "500.00", taxRatePercent: "0.00", sacCode: null } as unknown as ServiceItemRecord;

function render(props: { services?: ServiceItemRecord[]; mayManageServices?: boolean } = {}) {
  return renderToStaticMarkup(createElement(InvoiceEditor, {
    registrationId: "reg-1", initial: draft, services: props.services ?? [], mayCreate: true, mayDiscard: true,
    mayManageServices: props.mayManageServices ?? false,
  }));
}

describe("bill editor service picker", () => {
  it("explains an empty price list and links managers to Settings → Billing", () => {
    const html = render({ mayManageServices: true });
    expect(html).toContain("No services yet. Add your price list in");
    expect(html).toContain('href="/settings/billing"');
    expect(html).toContain("or use Add custom line.");
    expect(html).not.toContain('id="bill-service"');
  });

  it("tells other users to ask an admin, without a settings link", () => {
    const html = render();
    expect(html).toContain("No services yet. Ask an admin to add services");
    expect(html).not.toContain('href="/settings/billing"');
  });

  it("lists services as “Name — ₹price” and disables Add service until one is chosen", () => {
    const html = render({ services: [xray] });
    expect(html).toContain("X-ray — ₹500.00");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Add service<\/button>/);
  });
});

describe("bill editor labels", () => {
  it("shows categories, totals and status in front-desk wording", () => {
    const html = render({ services: [xray] });
    expect(html).toContain('<option value="CONSULTATION" selected="">Consultation</option>');
    expect(html).toContain(">Procedure</option>");
    expect(html).not.toContain(">CONSULTATION</option>");
    for (const label of ["Subtotal", "Discount", "Taxable amount", "Grand total"]) expect(html).toContain(`>${label}</dt>`);
    expect(html).toContain("Draft · saved");
  });

  it("hides CGST and SGST while both are ₹0 and shows them once GST applies", () => {
    expect(render()).not.toContain(">CGST</dt>");
    const taxed = { ...draft, lines: [{ ...draft.lines[0], taxRatePercent: "18.00" }] } as InvoiceRecord;
    const html = renderToStaticMarkup(createElement(InvoiceEditor, { registrationId: "reg-1", initial: taxed, services: [], mayCreate: true, mayDiscard: true }));
    expect(html).toContain(">CGST</dt>");
    expect(html).toContain(">SGST</dt>");
  });
});

describe("invoiceTotalRows", () => {
  it("labels totals in order and drops zero GST rows", async () => {
    const { invoiceTotalRows } = await import("@/lib/billing/billingLabels");
    const zeroGst = { subtotal: "500.00", discountTotal: "0.00", taxableTotal: "500.00", cgstTotal: "0.00", sgstTotal: "0.00", grandTotal: "500.00" };
    expect(invoiceTotalRows(zeroGst).map((row) => row.label)).toEqual(["Subtotal", "Discount", "Taxable amount", "Grand total"]);
    expect(invoiceTotalRows({ ...zeroGst, cgstTotal: 45, sgstTotal: 45 } as never).map((row) => row.label))
      .toEqual(["Subtotal", "Discount", "Taxable amount", "CGST", "SGST", "Grand total"]);
  });
});

describe("bill preview before issuing", () => {
  it("renders the saved draft as the future document, watermarked and without a number", async () => {
    const { default: InvoiceDocument } = await import("@/components/billing/InvoiceDocument");
    const preview = {
      clinic: { name: "Synthetic Clinic", legalName: null, address: "1 Test Road", city: "Pune", logoUrl: null, gstin: "27AAAAA0000A1Z5", footerNote: null },
      patient: { patientCode: "P-0001", name: "Test Patient", age: 30, gender: "Female", mobileNumber: "9000000000", city: null },
      doctor: { name: "Dr Synthetic", department: "General" }, visit: { date: "2026-09-30T10:00:00.000Z", type: "NEW" },
      lines: draft.lines, totals: draft.totals, documentType: "BILL_OF_SUPPLY", invoiceNumber: null, issuedAt: null,
    } as const;
    const html = renderToStaticMarkup(createElement(InvoiceDocument, { snapshot: preview as never }));
    expect(html).toContain("DRAFT — not yet issued");
    expect(html).toContain("Number assigned on issue");
    expect(html).toContain("Bill of Supply");
    for (const text of ["Synthetic Clinic", "Test Patient · P-0001", "9000000000", "Dr Synthetic", "Consultation", "Amount in words:"]) expect(html).toContain(text);
    expect(html).not.toContain("Invalid Date");
  });

  it("leaves issued documents unchanged: number shown, no draft watermark", async () => {
    const { default: InvoiceDocument } = await import("@/components/billing/InvoiceDocument");
    const issued = {
      clinic: { name: "Synthetic Clinic", legalName: null, address: "", city: "", logoUrl: null, gstin: null, footerNote: null },
      patient: { patientCode: "P-0001", name: "Test Patient", age: null, gender: null, mobileNumber: "9000000000", city: null },
      doctor: null, visit: { date: "2026-09-30T10:00:00.000Z", type: "NEW" }, lines: draft.lines, totals: draft.totals,
      documentType: "INVOICE", invoiceNumber: "INV-2627-00001", issuedAt: "2026-09-30T10:05:00.000Z",
    } as const;
    const html = renderToStaticMarkup(createElement(InvoiceDocument, { snapshot: issued as never }));
    expect(html).toContain("INV-2627-00001");
    expect(html).not.toContain("DRAFT — not yet issued");
    expect(html).not.toContain("Number assigned on issue");
  });

  it("keeps Review enabled: it saves first rather than waiting on Save draft", () => {
    const html = render({ services: [xray] });
    expect(html).toMatch(/<button(?![^>]*disabled="")[^>]*>Review bill<\/button>/);
  });
});

describe("documentTypeFor", () => {
  it("matches what issuing assigns", async () => {
    const { documentTypeFor } = await import("@/lib/billing/documentType");
    expect(documentTypeFor(null, false)).toBe("INVOICE");
    expect(documentTypeFor("27AAAAA0000A1Z5", true)).toBe("TAX_INVOICE");
    expect(documentTypeFor("27AAAAA0000A1Z5", false)).toBe("BILL_OF_SUPPLY");
  });
});
