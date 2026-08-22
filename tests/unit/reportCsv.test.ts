import { describe, expect, it } from "vitest";
import { CSV_BOM } from "@/lib/csv";
import {
  REPORT_EXPORT_SECTIONS,
  isReportExportSection,
  reportCsvFilename,
  toReportCsv,
  type ReportExportSection,
} from "@/lib/reportCsv";
import type { BreakdownRow, RevenuePoint, RevenueReport } from "@/lib/reports";

function point(overrides: Partial<RevenuePoint> = {}): RevenuePoint {
  return {
    bucket: "2026-08-01",
    label: "Aug",
    fullLabel: "August 2026",
    revenue: "150000.00",
    value: 150000,
    registrations: 42,
    ...overrides,
  };
}

function row(overrides: Partial<BreakdownRow> = {}): BreakdownRow {
  return {
    id: "clinic-1",
    name: "Main Street Dental",
    revenue: "150000.00",
    registrations: 42,
    sharePercent: 62.5,
    ...overrides,
  };
}

function report(overrides: Partial<RevenueReport> = {}): RevenueReport {
  return {
    period: "monthly",
    rangeLabel: "August 2026",
    rangeStartDate: "2026-08-01",
    kpis: {
      totalRevenue: "240000.00",
      registrationCount: 70,
      patientCount: 64,
      averageRevenuePerPatient: "3750.00",
      previousRevenue: "200000.00",
      revenueChangePercent: 20,
    },
    series: [point()],
    byClinic: [row()],
    byDoctor: [row({ id: "doctor-1", name: "Dr Amelia Rao" })],
    clinicName: null,
    hasClinics: true,
    ...overrides,
  };
}

/** The data rows, BOM and header stripped, for asserting on content. */
function dataRows(csv: string): string[] {
  return csv
    .slice(CSV_BOM.length)
    .trimEnd()
    .split("\r\n")
    .slice(1);
}

function headerOf(csv: string): string {
  return csv.slice(CSV_BOM.length).split("\r\n")[0];
}

describe("isReportExportSection", () => {
  it("accepts exactly the three sections the report has", () => {
    for (const section of REPORT_EXPORT_SECTIONS) {
      expect(isReportExportSection(section)).toBe(true);
    }
    expect(REPORT_EXPORT_SECTIONS).toHaveLength(3);
  });

  it("refuses anything else, including a near miss", () => {
    // The route turns a false here into a 400 rather than guessing, so this is
    // the guard that stops someone being handed the wrong figures under a
    // plausible filename.
    for (const value of ["", "kpis", "clinic", "Clinics", "all", "../trend"]) {
      expect(isReportExportSection(value)).toBe(false);
    }
  });
});

describe("the trend export", () => {
  it("names the period twice — once to sort by, once to read", () => {
    expect(headerOf(toReportCsv(report(), "trend"))).toBe(
      "Period Starting,Period,Registrations,Revenue (INR)",
    );
  });

  it("writes one row per bucket, in the order the graph draws them", () => {
    const csv = toReportCsv(
      report({
        series: [
          point({ bucket: "2026-07-01", fullLabel: "July 2026", revenue: "90000.00", registrations: 28 }),
          point(),
        ],
      }),
      "trend",
    );

    expect(dataRows(csv)).toEqual([
      "2026-07-01,July 2026,28,90000.00",
      "2026-08-01,August 2026,42,150000.00",
    ]);
  });

  it("keeps the zero-filled buckets the graph shows", () => {
    // A month with no visits is a zero on the chart, so it is a zero in the
    // file. Dropping it would let a reader mistake a quiet month for a gap in
    // the data.
    const csv = toReportCsv(
      report({
        series: [point({ revenue: "0.00", value: 0, registrations: 0 })],
      }),
      "trend",
    );

    expect(dataRows(csv)).toEqual(["2026-08-01,August 2026,0,0.00"]);
  });
});

describe("the breakdown exports", () => {
  it("names the entity column for what it holds", () => {
    expect(headerOf(toReportCsv(report(), "clinics"))).toBe(
      "Clinic,Registrations,Revenue (INR),Share %",
    );
    expect(headerOf(toReportCsv(report(), "doctors"))).toBe(
      "Doctor,Registrations,Revenue (INR),Share %",
    );
  });

  it("exports the clinic rows for the clinic section and the doctor rows for the doctor one", () => {
    expect(dataRows(toReportCsv(report(), "clinics"))[0]).toContain(
      "Main Street Dental",
    );
    expect(dataRows(toReportCsv(report(), "doctors"))[0]).toContain(
      "Dr Amelia Rao",
    );
  });

  it("writes the share to two places", () => {
    expect(dataRows(toReportCsv(report(), "clinics"))).toEqual([
      "Main Street Dental,42,150000.00,62.50",
    ]);
  });

  it("keeps the unassigned bucket, which the totals include", () => {
    const csv = toReportCsv(
      report({ byDoctor: [row({ id: null, name: "Not assigned" })] }),
      "doctors",
    );
    expect(dataRows(csv)[0]).toContain("Not assigned");
  });

  it("still writes a header when the period earned nothing", () => {
    expect(dataRows(toReportCsv(report({ byClinic: [] }), "clinics"))).toEqual([]);
    expect(headerOf(toReportCsv(report({ byClinic: [] }), "clinics"))).toContain(
      "Clinic",
    );
  });
});

describe("what lands in a cell", () => {
  it("writes money unformatted, so a spreadsheet can total the column", () => {
    const csv = toReportCsv(report(), "clinics");
    expect(csv).toContain("150000.00");
    expect(csv).not.toContain("₹");
    expect(csv).not.toContain("1,50,000");
  });

  it("quotes a clinic name containing the delimiter", () => {
    const csv = toReportCsv(
      report({ byClinic: [row({ name: "Rao, Amelia & Partners" })] }),
      "clinics",
    );
    expect(dataRows(csv)[0]).toBe('"Rao, Amelia & Partners",42,150000.00,62.50');
  });

  it("defuses a clinic named as a formula", () => {
    // A tenant names their own clinics, so the name is user input reaching a
    // file someone will open in Excel.
    const csv = toReportCsv(
      report({ byClinic: [row({ name: "=cmd|'/c calc'!A1" })] }),
      "clinics",
    );
    expect(dataRows(csv)[0].startsWith("'=cmd")).toBe(true);
  });

  it("opens every section with a BOM", () => {
    for (const section of REPORT_EXPORT_SECTIONS) {
      expect(toReportCsv(report(), section).startsWith(CSV_BOM)).toBe(true);
    }
  });
});

describe("reportCsvFilename", () => {
  it("names the section and the period", () => {
    expect(reportCsvFilename(report(), "clinics")).toBe(
      "revenue-by-clinic-monthly-2026-08-01.csv",
    );
    expect(reportCsvFilename(report(), "doctors")).toBe(
      "revenue-by-doctor-monthly-2026-08-01.csv",
    );
  });

  it("names the trend for its own span, which reaches past the period", () => {
    // The graph shows twelve months ending with the current one; calling the
    // file `…-2026-08-01` would understate what is in it by eleven months.
    const csv = reportCsvFilename(
      report({
        series: [point({ bucket: "2025-09-01" }), point({ bucket: "2026-08-01" })],
      }),
      "trend",
    );
    expect(csv).toBe("revenue-trend-monthly-2025-09-01-to-2026-08-01.csv");
  });

  it("does not repeat itself when the trend is a single bucket", () => {
    expect(reportCsvFilename(report(), "trend")).toBe(
      "revenue-trend-monthly-2026-08-01.csv",
    );
  });

  it("falls back to the period start when there is no series at all", () => {
    expect(reportCsvFilename(report({ series: [] }), "trend")).toBe(
      "revenue-trend-monthly-2026-08-01.csv",
    );
  });

  it("dates the window, not the download", () => {
    // Two people exporting the same report a week apart must get the same
    // filename, or a shared folder fills with near-duplicates.
    const first = reportCsvFilename(report(), "clinics");
    const second = reportCsvFilename(report(), "clinics");
    expect(first).toBe(second);
    expect(first).toContain("2026-08-01");
  });

  it("survives a Content-Disposition header for every section and period", () => {
    // Nothing user-written reaches the filename — no clinic name, no doctor —
    // so a quote or a newline in a tenant's own data can never break out of the
    // header or smuggle a second one.
    for (const period of ["daily", "weekly", "monthly", "yearly"] as const) {
      for (const section of REPORT_EXPORT_SECTIONS) {
        const name = reportCsvFilename(
          report({ period, clinicName: 'Rao"\r\nX-Injected: 1' }),
          section as ReportExportSection,
        );
        expect(name).toMatch(/^[a-z0-9-]+\.csv$/);
      }
    }
  });
});
