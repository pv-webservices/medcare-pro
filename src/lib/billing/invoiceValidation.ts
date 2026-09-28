import { z } from "zod";
import { serviceCategories } from "./billingValidation";
import { computeLine, computeTotals, fromPaise, toPaise } from "./invoiceMath";

const money = z.string().regex(/^\d{1,8}(?:\.\d{1,2})?$/)
  .transform((value) => fromPaise(toPaise(value)));
export const invoiceLineSchema = z.strictObject({
  serviceItemId: z.string().min(1).nullable().default(null),
  description: z.string().trim().min(1).max(200),
  category: z.enum(serviceCategories),
  quantity: z.number().int().min(1).max(999),
  unitPrice: money,
  discountAmount: money,
  taxRatePercent: money.refine((value) => toPaise(value) <= 4000, "GST must be between 0 and 40 percent."),
  sacCode: z.string().regex(/^\d{1,8}$/).nullable().default(null),
});
export const saveInvoiceSchema = z.strictObject({
  revision: z.number().int().nonnegative(),
  lines: z.array(invoiceLineSchema),
}).superRefine((value, ctx) => {
  try { computeTotals(value.lines.map(computeLine)); }
  catch (error) {
    if (!(error instanceof RangeError)) throw error;
    ctx.addIssue({ code: "custom", path: ["lines"], message: error.message });
  }
});
export const issueInvoiceSchema = z.strictObject({ revision: z.number().int().nonnegative() });
export const emptyInvoiceBodySchema = z.strictObject({});
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, "Invalid date.");
export const invoiceFiltersSchema = z.strictObject({
  clinicId: z.string().min(1).optional(),
  doctorId: z.string().min(1).optional(),
  status: z.enum(["DRAFT", "ISSUED", "CANCELLED"]).optional(),
  paymentStatus: z.enum(["UNPAID", "PARTIAL", "PAID"]).optional(),
  from: date.optional(),
  to: date.optional(),
  search: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).max(1000000).default(1),
}).refine((value) => !value.from || !value.to || value.from <= value.to, "Start date must not follow end date.");
export type InvoiceLineInput = z.output<typeof invoiceLineSchema>;
export type InvoiceFilters = z.output<typeof invoiceFiltersSchema>;

export interface InvoiceSnapshot {
  clinic: { name: string; legalName: string | null; address: string | null; city: string | null; logoUrl: string | null; gstin: string | null; footerNote: string | null };
  patient: { patientCode: string; name: string; age: number | null; gender: string | null; mobileNumber: string; city: string | null };
  doctor: { name: string; department: string } | null;
  visit: { date: string; type: string };
  lines: Array<InvoiceLineInput & { position: number; taxableAmount: string; taxAmount: string; lineTotal: string }>;
  totals: { subtotal: string; discountTotal: string; taxableTotal: string; cgstTotal: string; sgstTotal: string; grandTotal: string };
  invoiceNumber: string;
  documentType: "INVOICE" | "TAX_INVOICE" | "BILL_OF_SUPPLY";
  issuedAt: string;
}
