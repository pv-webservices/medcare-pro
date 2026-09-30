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
