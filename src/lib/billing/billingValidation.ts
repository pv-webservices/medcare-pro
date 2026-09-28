import { z } from "zod";
import { isValidGstin } from "./gstin";
import { fromPaise, toPaise } from "./invoiceMath";

// Strings throughout the API: do not round or coerce browser floating-point values.
function decimal(max: number) {
  return z.string().regex(/^\d{1,8}(?:\.\d{1,2})?$/, "Use a non-negative amount with at most two decimals.")
    .refine((value) => {
      try { return toPaise(value) <= max; } catch { return false; }
    }, "Value exceeds the allowed limit.")
    .transform((value) => fromPaise(toPaise(value)));
}
const optionalText = (max: number) => z.string().trim().max(max).nullable().optional()
  .transform((value) => value || null);
export const serviceCategories = ["CONSULTATION", "PROCEDURE", "TEST", "OTHER"] as const;
export const billingSettingsSchema = z.strictObject({
  gstin: optionalText(15).refine((value) => value === null || isValidGstin(value), "Enter a valid GSTIN."),
  legalName: optionalText(200),
  invoicePrefix: z.string().regex(/^[A-Z0-9]{1,4}$/, "Use 1–4 uppercase letters or digits.").default("INV"),
  staffDiscountLimitPercent: decimal(10000).default("0.00"),
  footerNote: optionalText(500),
});
const serviceItemFields = z.strictObject({
  clinicId: z.string().trim().min(1).nullable(),
  name: z.string().trim().min(1).max(120),
  category: z.enum(serviceCategories),
  price: decimal(9_999_999_999),
  taxRatePercent: decimal(4000),
  sacCode: optionalText(8).refine((value) => value === null || /^\d{1,8}$/.test(value), "SAC must contain 1–8 digits."),
  isActive: z.boolean(),
});
export const createServiceItemSchema = serviceItemFields.extend({
  clinicId: serviceItemFields.shape.clinicId.default(null),
  taxRatePercent: serviceItemFields.shape.taxRatePercent.default("0.00"),
  isActive: serviceItemFields.shape.isActive.default(true),
});
// Do not inherit create defaults into PATCH: Zod applies defaults inside optional fields.
export const updateServiceItemSchema = serviceItemFields.partial()
  .refine((value) => Object.keys(value).length > 0, "Supply at least one change.");
export const serviceItemFiltersSchema = z.strictObject({
  clinicId: z.string().trim().min(1).optional(),
  includeInactive: z.enum(["true", "false"]).optional().transform((value) => value === "true"),
});
export type BillingSettingsInput = z.output<typeof billingSettingsSchema>;
export type ServiceItemInput = z.output<typeof createServiceItemSchema>;
