/**
 * The CSV rules every export in this app obeys — RFC 4180, plus two
 * concessions to the spreadsheet that will actually open the file.
 *
 * This module was extracted from src/lib/registrationCsv.ts in Stage 7, when a
 * second exporter arrived. The escaping is the part that must never drift
 * between them: a formula guard that protects the registration list but not the
 * revenue report is worse than none, because it reads as though both are safe.
 *
 * Pure and dependency-free — no Prisma, no session, no domain types. Each
 * exporter owns its own columns and supplies plain strings.
 */

/**
 * Excel reads a CSV as the system codepage unless a byte-order mark says
 * otherwise, which turns a patient named Priyā into mojibake.
 */
export const CSV_BOM = "﻿";

/**
 * True when a spreadsheet would treat the cell as a formula rather than text.
 *
 * `+` and `-` are excluded for values that read as a phone number or a plain
 * figure — quoting every `+91…` mobile number would make the export worse for
 * the common case without closing anything, since neither can name a function.
 */
const PHONE_OR_NUMBER = /^[+-][\d\s()-]*$/;

function needsFormulaGuard(value: string): boolean {
  if (value === "") {
    return false;
  }

  if (/^[=@\t\r]/.test(value)) {
    return true;
  }

  return /^[+-]/.test(value) && !PHONE_OR_NUMBER.test(value);
}

/**
 * One cell, guarded and quoted.
 *
 * The leading apostrophe on a formula-shaped value is what stops
 * `=cmd|'/c calc'!A1` typed into a patient name from executing when the file is
 * opened (CSV injection). The quoting is RFC 4180: anything containing a
 * delimiter, a quote or a newline is wrapped, and inner quotes are doubled.
 */
export function escapeCsvCell(value: string): string {
  const guarded = needsFormulaGuard(value) ? `'${value}` : value;

  if (/[",\r\n]/.test(guarded)) {
    return `"${guarded.replace(/"/g, '""')}"`;
  }

  return guarded;
}

/**
 * Rows of already-stringified cells into a finished document.
 *
 * CRLF line endings — the RFC 4180 default, and what Excel expects. The
 * trailing newline is deliberate: a file that ends mid-record makes some
 * parsers drop the last row.
 */
export function toCsvDocument(rows: readonly (readonly string[])[]): string {
  const body = rows
    .map((cells) => cells.map(escapeCsvCell).join(","))
    .join("\r\n");

  return `${CSV_BOM}${body}\r\n`;
}

/**
 * A column definition shared by both exporters: a header, and how to read the
 * cell out of one record.
 */
export interface CsvColumn<T> {
  header: string;
  value: (record: T) => string;
}

/** Header row followed by one row per record, escaped and joined. */
export function toCsv<T>(
  columns: readonly CsvColumn<T>[],
  records: readonly T[],
): string {
  return toCsvDocument([
    columns.map((column) => column.header),
    ...records.map((record) => columns.map((column) => column.value(record))),
  ]);
}
