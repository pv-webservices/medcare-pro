import { describe, expect, it } from "vitest";
import { collectionsCsvFilename, isCollectionsExportSection, toCollectionsCsv } from "@/lib/billing/collectionsCsv";
import type { CollectionsReport } from "@/lib/billing/collectionsReport";

const point = (bucket: string, revenue: string, registrations: number) => ({ bucket, label: bucket, fullLabel: `Month ${bucket}`, revenue, value: Number(revenue), registrations });
const report: CollectionsReport = {
  period: "monthly", rangeLabel: "September 2026", rangeStartDate: "2026-09-01", asOf: "2026-09-29T06:30:00.000Z",
  kpis: { billed: "1500.00", billCount: 2, previousBilled: "0.00", collected: "700.00", paymentCount: 2, previousCollected: "0.00",
    outstanding: "800.00", outstandingCount: 1, discounts: "50.00", cgst: "9.00", sgst: "9.00", gst: "18.00" },
  billedSeries: [point("2026-08-01", "0.00", 0), point("2026-09-01", "1500.00", 2)],
  collectedSeries: [point("2026-08-01", "0.00", 0), point("2026-09-01", "700.00", 1)],
  byPaymentMode: [{ id: "UPI", name: "UPI", revenue: "700.00", registrations: 2, sharePercent: 100 }],
  byClinic: [{ id: "c1", name: "Clinic, North", revenue: "700.00", registrations: 2, sharePercent: 100, billed: "1500.00", billCount: 2,
    outstanding: "800.00", discounts: "50.00", cgst: "9.00", sgst: "9.00" }],
  clinicName: null, hasClinics: true,
};

describe("collections CSV", () => {
  it("accepts only the three sections", () => {
    expect(["trend", "modes", "clinics"].every(isCollectionsExportSection)).toBe(true);
    expect(isCollectionsExportSection("doctors")).toBe(false);
  });

  it("writes the trend with billed and collected side by side, unformatted", () => {
    const lines = toCollectionsCsv(report, "trend").replace(/^﻿/, "").trim().split(/\r?\n/);
    expect(lines[0]).toBe("Period Starting,Period,Bills issued,Billed (INR),Visits paid,Collected (INR)");
    expect(lines[2]).toBe("2026-09-01,Month 2026-09-01,2,1500.00,1,700.00");
  });

  it("writes every clinic figure with point-in-time outstanding", () => {
    const csv = toCollectionsCsv(report, "clinics");
    expect(csv).toContain("Clinic,Bills issued,Billed (INR),Payments,Collected (INR),Discounts (INR),CGST (INR),SGST (INR),Outstanding now (INR)");
    expect(csv).toContain('"Clinic, North",2,1500.00,2,700.00,50.00,9.00,9.00,800.00');
    expect(toCollectionsCsv(report, "modes")).toContain("UPI,2,700.00,100.00");
  });

  it("names files for the reported window", () => {
    expect(collectionsCsvFilename(report, "clinics")).toBe("collections-by-clinic-monthly-2026-09-01.csv");
    expect(collectionsCsvFilename(report, "trend")).toBe("collections-trend-monthly-2026-08-01-to-2026-09-01.csv");
  });
});
