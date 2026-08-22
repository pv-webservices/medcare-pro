import { describe, expect, it } from "vitest";
import { CSV_BOM, escapeCsvCell, toCsv, toCsvDocument } from "@/lib/csv";

/**
 * The escaping shared by every export in the app. Extracted in Stage 7 from the
 * registration exporter, so these tests are as much a regression guard on that
 * one as they are coverage of the new revenue export.
 */

describe("escapeCsvCell", () => {
  it("leaves an ordinary value untouched", () => {
    expect(escapeCsvCell("Amelia Rao")).toBe("Amelia Rao");
    expect(escapeCsvCell("")).toBe("");
  });

  it("quotes a value containing the delimiter", () => {
    expect(escapeCsvCell("Rao, Amelia")).toBe('"Rao, Amelia"');
  });

  it("quotes and doubles an embedded quote", () => {
    expect(escapeCsvCell('Amelia "Amy" Rao')).toBe('"Amelia ""Amy"" Rao"');
  });

  it("quotes a value spanning lines", () => {
    expect(escapeCsvCell("12 Main St\nBengaluru")).toBe('"12 Main St\nBengaluru"');
    expect(escapeCsvCell("a\r\nb")).toBe('"a\r\nb"');
  });
});

describe("the formula guard", () => {
  // CSV injection: a spreadsheet evaluates a cell beginning with one of these,
  // so a patient name is an attack surface the moment the file is opened.
  it("defuses every leading character a spreadsheet would evaluate", () => {
    expect(escapeCsvCell("=1+1")).toBe("'=1+1");
    expect(escapeCsvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(escapeCsvCell("\tcmd")).toBe("'\tcmd");
  });

  it("defuses the classic command payload", () => {
    expect(escapeCsvCell("=cmd|'/c calc'!A1")).toBe("'=cmd|'/c calc'!A1");
  });

  it("guards a formula that opens with a sign", () => {
    expect(escapeCsvCell("-2+3+cmd|' /C calc'!A0")).toBe(
      "'-2+3+cmd|' /C calc'!A0",
    );
  });

  it("leaves a phone number alone, sign and all", () => {
    // Quoting every +91… number would make the file worse for the common case,
    // and neither a digit run nor a bracket can name a function.
    expect(escapeCsvCell("+919876543210")).toBe("+919876543210");
    expect(escapeCsvCell("+91 (98) 765-43210")).toBe("+91 (98) 765-43210");
  });

  it("guards a signed decimal, because the exemption stops at the point", () => {
    // Pinning behaviour carried over unchanged from the registration exporter,
    // not endorsing it: the phone-shaped exemption has no `.` in its character
    // class, so `-150.00` is written as text. Nothing exports a negative money
    // value today — registration amounts and every revenue total derived from
    // them are non-negative — so this is latent, not live. Widening the
    // exemption would change what the registration export writes, which is not
    // this stage's business.
    expect(escapeCsvCell("-150.00")).toBe("'-150.00");
    expect(escapeCsvCell("150.00")).toBe("150.00");
  });

  it("never guards a value whose trigger is not the first character", () => {
    expect(escapeCsvCell("Clinic A = B")).toBe("Clinic A = B");
  });
});

describe("toCsvDocument", () => {
  it("opens with a BOM, so Excel reads UTF-8", () => {
    expect(toCsvDocument([["Name"]]).startsWith(CSV_BOM)).toBe(true);
  });

  it("separates records with CRLF and terminates the last one", () => {
    expect(toCsvDocument([["a", "b"], ["c", "d"]])).toBe(
      `${CSV_BOM}a,b\r\nc,d\r\n`,
    );
  });

  it("escapes the header row too", () => {
    expect(toCsvDocument([["Revenue, total"]])).toBe(
      `${CSV_BOM}"Revenue, total"\r\n`,
    );
  });

  it("survives a non-Latin name intact", () => {
    expect(toCsvDocument([["प्रियंका"]])).toContain("प्रियंका");
  });
});

describe("toCsv", () => {
  interface Row {
    name: string;
    amount: string;
  }

  const columns = [
    { header: "Name", value: (row: Row) => row.name },
    { header: "Amount (INR)", value: (row: Row) => row.amount },
  ];

  it("writes a header row followed by one row per record", () => {
    expect(toCsv(columns, [{ name: "Riverside", amount: "1500.00" }])).toBe(
      `${CSV_BOM}Name,Amount (INR)\r\nRiverside,1500.00\r\n`,
    );
  });

  it("still writes the header when there is nothing to export", () => {
    // An empty file gives a reader no way to tell "no rows" from "download
    // broke". A header alone says which report came back empty.
    expect(toCsv(columns, [])).toBe(`${CSV_BOM}Name,Amount (INR)\r\n`);
  });
});
