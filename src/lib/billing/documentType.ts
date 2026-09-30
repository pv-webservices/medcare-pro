import type { InvoiceSnapshot } from "./invoiceValidation";

/**
 * FR-11.12: the document type fixed at issue. Shared by issueInvoice and the
 * pre-issue preview, so the preview always names the type the bill will get.
 */
export function documentTypeFor(gstin: string | null, anyLineTaxed: boolean): InvoiceSnapshot["documentType"] {
  if (!gstin) return "INVOICE";
  return anyLineTaxed ? "TAX_INVOICE" : "BILL_OF_SUPPLY";
}
