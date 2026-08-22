import { toCsv, type CsvColumn } from "@/lib/csv";
import type { OwnerAuditEntry } from "@/lib/platform/auditLog";

/**
 * The audit trail as CSV — Stage 11, Owner surface only.
 *
 * Reuses the RFC 4180 core in lib/csv.ts, so the escaping, the UTF-8 BOM and the
 * formula-injection guard are the same ones the registration and revenue
 * exports use. This file owns only its columns.
 *
 * WHY THE JSON COLUMNS ARE STRINGIFIED RATHER THAN FLATTENED. `beforeValue` and
 * `afterValue` have a different shape for every action; spreading them into
 * columns would mean a header row that changes with the filter, which no
 * spreadsheet and no diff tool copes with well. One JSON string per cell keeps
 * the file rectangular and machine-readable, and the escaping in lib/csv.ts
 * already handles the quotes and commas inside it.
 *
 * THE FORMULA GUARD MATTERS MORE HERE THAN ANYWHERE ELSE IN THIS APP. Audit
 * rows carry `userAgent`, which is attacker-controlled: a client is free to send
 * `=cmd|'/c calc'!A1` as its user agent, and it would sit in the table until a
 * support engineer opened the export in Excel. `escapeCsvCell` neutralises it.
 */

/** Stable, sortable, and unambiguous across locales. */
function timestamp(value: Date): string {
  return value.toISOString().replace("T", " ").slice(0, 19);
}

function json(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  try {
    return JSON.stringify(value);
  } catch {
    // Prisma hands back plain JSON, so this cannot normally happen. Returning a
    // marker rather than throwing keeps one malformed row from failing an
    // export a support engineer is mid-incident with.
    return "[unserialisable]";
  }
}

const COLUMNS: readonly CsvColumn<OwnerAuditEntry>[] = [
  { header: "Timestamp (UTC)", value: (entry) => timestamp(entry.createdAt) },
  { header: "Action", value: (entry) => entry.action },
  { header: "Description", value: (entry) => entry.label },
  { header: "Category", value: (entry) => entry.category },
  { header: "Side", value: (entry) => entry.side },
  { header: "Organisation", value: (entry) => entry.tenantName ?? "" },
  { header: "Organisation ID", value: (entry) => entry.tenantId ?? "" },
  { header: "Actor", value: (entry) => entry.actorName ?? "" },
  { header: "Actor Email", value: (entry) => entry.actorEmail ?? "" },
  { header: "Target Type", value: (entry) => entry.targetType },
  { header: "Target ID", value: (entry) => entry.targetId ?? "" },
  { header: "Reason", value: (entry) => entry.reason ?? "" },
  { header: "IP", value: (entry) => entry.ip ?? "" },
  { header: "User Agent", value: (entry) => entry.userAgent ?? "" },
  { header: "Before", value: (entry) => json(entry.beforeValue) },
  { header: "After", value: (entry) => json(entry.afterValue) },
];

export function toAuditCsv(entries: readonly OwnerAuditEntry[]): string {
  return toCsv(COLUMNS, entries);
}

/**
 * A filename that says what the file holds without naming an organisation.
 *
 * Deliberately free of tenant text: the name travels in a Content-Disposition
 * header, and header encoding of arbitrary business names is a class of bug
 * worth not having. The organisation is inside the file, in its own column.
 */
export function auditCsvFilename(now: Date = new Date()): string {
  return `medcare-activity-log-${now.toISOString().slice(0, 10)}.csv`;
}
