import { randomUUID } from "node:crypto";

/** Globally unique, clinic-safe identifiers without a shared counter hotspot.
 * The complete UUID is retained; a database UNIQUE constraint is the final guard.
 */
export function generatePrescriptionNumber(now = new Date()): string {
  return `RX-${now.getUTCFullYear()}-${randomUUID().replaceAll("-", "").toUpperCase()}`;
}
