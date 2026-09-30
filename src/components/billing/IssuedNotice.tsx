"use client";
import { useEffect, useSyncExternalStore } from "react";

/**
 * "Bill INV-… issued." once, on the page the editor lands on after issuing.
 * The editor leaves the number in sessionStorage; the first read takes it, so a
 * reload or a later visit to the same bill shows no message. The URL stays
 * /billing/[id].
 */
const KEY = (invoiceId: string) => `medcare:bill-issued:${invoiceId}`;
const taken = new Map<string, string | null>();

export function rememberIssued(invoiceId: string, invoiceNumber: string) {
  try { window.sessionStorage.setItem(KEY(invoiceId), invoiceNumber); } catch { /* storage blocked: no message, nothing else lost */ }
}

function take(invoiceId: string): string | null {
  if (!taken.has(invoiceId)) {
    let value: string | null = null;
    try { value = window.sessionStorage.getItem(KEY(invoiceId)); window.sessionStorage.removeItem(KEY(invoiceId)); } catch { value = null; }
    taken.set(invoiceId, value);
  }
  return taken.get(invoiceId) ?? null;
}

export default function IssuedNotice({ invoiceId }: { invoiceId: string }) {
  const number = useSyncExternalStore(() => () => {}, () => take(invoiceId), () => null);
  useEffect(() => () => { taken.delete(invoiceId); }, [invoiceId]);
  if (!number) return null;
  return <p role="status" className="rounded-2xl border border-ok-line bg-ok-bg p-4 font-semibold text-ok-ink">Bill {number} issued.</p>;
}
