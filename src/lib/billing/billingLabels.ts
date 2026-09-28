import type { StatusTone } from "@/components/ui/StatusPill";

/** Front-desk wording for billing enums. Codes stay in URLs, filters and exports. */
export const INVOICE_STATUS_LABELS = { DRAFT: "Draft", ISSUED: "Issued", CANCELLED: "Cancelled" } as const;
export const PAYMENT_STATUS_LABELS = { UNPAID: "Unpaid", PARTIAL: "Partly paid", PAID: "Paid" } as const;
export const PAYMENT_MODE_LABELS = { CASH: "Cash", UPI: "UPI", CARD: "Card", BANK_TRANSFER: "Bank transfer", OTHER: "Other" } as const;
export const DUES_AGE_LABELS = { "0-7": "0–7 days", "8-30": "8–30 days", "31+": "31+ days" } as const;
export const PAYMENT_STATUS_TONES: Record<keyof typeof PAYMENT_STATUS_LABELS, StatusTone> = { UNPAID: "alert", PARTIAL: "warn", PAID: "ok" };
