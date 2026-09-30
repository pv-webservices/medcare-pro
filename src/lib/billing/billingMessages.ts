import { ZodError, type core } from "zod";
import { BadRequestError } from "@/lib/domainErrors";
import { computeLine, toPaise } from "./invoiceMath";

/**
 * Every billing message a person can see, in one place, for the bill editor and
 * the billing API alike.
 *
 * invoiceMath and the Zod schemas keep their precise internal wording (tests and
 * logs rely on it); nothing from them reaches a screen without passing through
 * here. Money checks reuse invoiceMath rather than repeating its rules.
 */
export const BILLING_MESSAGES = {
  unitPrice: "Enter a price like 500 or 499.50",
  quantity: "Whole number from 1 to 999",
  discountAmount: "Can't be more than the line amount",
  discountFormat: "Enter a discount like 50 or 49.50",
  taxRatePercent: "Enter a GST rate between 0 and 40",
  discountPercent: "Enter a discount between 0 and 100, e.g. 10",
  description: "Enter a description for this line",
  sacCode: "SAC code is up to 8 digits",
  amount: "Enter an amount like 500 or 499.50",
  tooLarge: "That amount is too large",
  discountOverSubtotal: "The discount can't be more than the subtotal",
  overpayment: "The payment is more than the balance due",
  generic: "Check the bill and try again.",
} as const;

export type LineField = "description" | "quantity" | "unitPrice" | "discountAmount" | "taxRatePercent" | "sacCode";
const LINE_FIELD_MESSAGES: Record<LineField, string> = {
  description: BILLING_MESSAGES.description,
  quantity: BILLING_MESSAGES.quantity,
  unitPrice: BILLING_MESSAGES.unitPrice,
  discountAmount: BILLING_MESSAGES.discountFormat,
  taxRatePercent: BILLING_MESSAGES.taxRatePercent,
  sacCode: BILLING_MESSAGES.sacCode,
};

/** Internal wording from invoiceMath / the schemas, and what a person reads instead. */
const RAW_TO_FRIENDLY: ReadonlyArray<[RegExp, string]> = [
  [/non-negative decimal/i, BILLING_MESSAGES.amount],
  [/outside the supported range/i, BILLING_MESSAGES.tooLarge],
  [/Quantity must be a whole number/i, BILLING_MESSAGES.quantity],
  [/Discount exceeds gross amount/i, BILLING_MESSAGES.discountAmount],
  [/GST (rate exceeds|must be between)/i, BILLING_MESSAGES.taxRatePercent],
  [/Discount must be between 0 and 100/i, BILLING_MESSAGES.discountPercent],
  [/Discount exceeds subtotal/i, BILLING_MESSAGES.discountOverSubtotal],
  [/Overpayments are not supported/i, BILLING_MESSAGES.overpayment],
];
/** Zod's default wording (and anything else schema-shaped) is never shown. */
const SCHEMA_WORDING = /^(Invalid|Too (small|big)|Expected|Unrecognized|Required)\b|must match pattern|non-negative decimal/i;

/** "10", "12.5", "12.50%" → the number as text; null unless 0–100 with at most 2 decimals. */
export function parseDiscountPercent(input: string): string | null {
  const value = input.trim().replace(/\s*%$/, "").trim();
  if (!/^\d{1,3}(?:\.\d{1,2})?$/.test(value)) return null;
  return toPaise(value) <= 10000 ? value : null;
}

function isAmount(value: string): boolean {
  try { toPaise(value); return true; } catch { return false; }
}

/** Inline problems for one editable line, keyed by field. Empty when the line is valid. */
export function lineFieldErrors(line: {
  description: string; quantity: number; unitPrice: string; discountAmount: string; taxRatePercent: string; sacCode: string | null;
}): Partial<Record<LineField, string>> {
  const errors: Partial<Record<LineField, string>> = {};
  if (!line.description.trim()) errors.description = BILLING_MESSAGES.description;
  if (!Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 999) errors.quantity = BILLING_MESSAGES.quantity;
  if (!isAmount(line.unitPrice)) errors.unitPrice = BILLING_MESSAGES.unitPrice;
  if (!isAmount(line.discountAmount)) errors.discountAmount = BILLING_MESSAGES.discountFormat;
  if (!isAmount(line.taxRatePercent) || toPaise(line.taxRatePercent) > 4000) errors.taxRatePercent = BILLING_MESSAGES.taxRatePercent;
  if (line.sacCode && !/^\d{1,8}$/.test(line.sacCode)) errors.sacCode = BILLING_MESSAGES.sacCode;
  if (!errors.quantity && !errors.unitPrice && !errors.discountAmount) {
    try { computeLine({ quantity: line.quantity, unitPrice: line.unitPrice, discountAmount: line.discountAmount, taxRatePercent: "0.00" }); }
    catch (error) { if (error instanceof RangeError) errors.discountAmount = friendlyBillingMessage(error.message); }
  }
  return errors;
}

/** Any message bound for a screen: internal wording becomes plain language, the rest passes through. */
export function friendlyBillingMessage(message: string): string {
  for (const [pattern, friendly] of RAW_TO_FRIENDLY) if (pattern.test(message)) return friendly;
  return SCHEMA_WORDING.test(message) ? BILLING_MESSAGES.generic : message;
}

/** One Zod issue from a billing schema, as a person should read it ("Line 2: …" for bill lines). */
export function friendlyBillingIssue(issue: Pick<core.$ZodIssue, "path" | "message">): string {
  const path = issue.path;
  const field = path.at(-1);
  const lineIndex = path[0] === "lines" && typeof path[1] === "number" ? path[1] : null;
  const prefix = lineIndex === null ? "" : `Line ${lineIndex + 1}: `;
  if (typeof field === "string" && field in LINE_FIELD_MESSAGES && lineIndex !== null) {
    // A money value in the right format can still fail a range rule; name the actual problem.
    const mapped = friendlyBillingMessage(issue.message);
    return prefix + (mapped !== BILLING_MESSAGES.generic && mapped !== issue.message ? mapped : LINE_FIELD_MESSAGES[field as LineField]);
  }
  if (field === "amount") return BILLING_MESSAGES.amount;
  return prefix + friendlyBillingMessage(issue.message);
}

/** The friendly text for a billing error, or null when the error's own message is already for people. */
export function friendlyBillingError(error: unknown): string | null {
  if (error instanceof ZodError) return error.issues[0] ? friendlyBillingIssue(error.issues[0]) : BILLING_MESSAGES.generic;
  if (error instanceof BadRequestError || error instanceof RangeError) {
    const friendly = friendlyBillingMessage(error.message);
    return friendly === error.message ? null : friendly;
  }
  return null;
}
