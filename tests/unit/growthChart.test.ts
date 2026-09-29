import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import GrowthChart from "@/components/reports/GrowthChart";
import type { RevenuePoint } from "@/lib/reports";

const series: RevenuePoint[] = [
  { bucket: "2026-08-01", label: "Aug", fullLabel: "August 2026", revenue: "1200.50", value: 1200.5, registrations: 3 },
  { bucket: "2026-09-01", label: "Sept", fullLabel: "September 2026", revenue: "950.00", value: 950, registrations: 1 },
];
const caption = "Revenue per month period across all clinics, ending with the current one.";

/**
 * The revenue report's chart as rendered BEFORE the optional title/legend props
 * existed, captured from the unchanged component. The defaults must reproduce
 * it byte for byte.
 */
const REVENUE_GOLDEN = readFileSync(resolve(import.meta.dirname, "fixtures/growthChart.revenue.html"), "utf8").trimEnd();

describe("GrowthChart", () => {
  it("renders the revenue report byte-identically with no title or legend given", () => {
    expect(renderToStaticMarkup(createElement(GrowthChart, { series, caption }))).toBe(REVENUE_GOLDEN);
  });

  it("uses the given title and legend instead of the revenue wording", () => {
    const html = renderToStaticMarkup(createElement(GrowthChart, { series, caption: "Billed per month", title: "Billed", legend: "Billed" }));
    expect(html).toContain(">Billed</h2>");
    expect(html).not.toContain("Revenue trend");
    expect(html).not.toContain("Total revenue");
  });
});
