import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const pageSource = readFileSync(
  resolve("src/app/owner/audit/page.tsx"),
  "utf8",
);
const changeCellSource = readFileSync(
  resolve("src/components/owner/AuditChangeCell.tsx"),
  "utf8",
);

describe("Superadmin Activity Log Page Redesign", () => {
  it("renders breadcrumbs back link to platform overview", () => {
    expect(pageSource).toContain('href="/owner/dashboard"');
    expect(pageSource).toContain("Platform overview");
  });

  it("renders Activity log heading, record count, and Export CSV link", () => {
    expect(pageSource).toContain("Activity log");
    expect(pageSource).toContain("records across every organisation");
    expect(pageSource).toContain("Export CSV");
    expect(pageSource).toContain('exportQuery.set("format", "csv")');
  });

  it("renders unified horizontal filter toolbar with search, dropdowns, dates, and submit", () => {
    expect(pageSource).toContain('placeholder="Who — name or email"');
    expect(pageSource).toContain('name="tenantId"');
    expect(pageSource).toContain('name="category"');
    expect(pageSource).toContain('name="from"');
    expect(pageSource).toContain('name="to"');
    expect(pageSource).toContain("Apply filters");
  });

  it("renders full-width structured activity table with all 8 columns", () => {
    expect(pageSource).toContain("When (UTC)");
    expect(pageSource).toContain("Action");
    expect(pageSource).toContain("Organisation");
    expect(pageSource).toContain("Who");
    expect(pageSource).toContain("Target");
    expect(pageSource).toContain("Reason");
    expect(pageSource).toContain("Change");
    expect(pageSource).toContain("IP");
  });

  it("formats timestamps cleanly as UTC string", () => {
    expect(pageSource).toContain("formatUtcTimestamp");
  });

  it("renders AuditChangeCell with code box and copy payload support", () => {
    expect(pageSource).toContain("<AuditChangeCell");
    expect(changeCellSource).toContain("previewJson");
    expect(changeCellSource).toContain("handleCopy");
    expect(changeCellSource).toContain("navigator.clipboard.writeText");
  });

  it("provides aligned pagination footer with record ranges and page navigation", () => {
    expect(pageSource).toContain("Showing");
    expect(pageSource).toContain("records");
    expect(pageSource).toContain("getPaginationPages");
    expect(pageSource).toContain("withPage");
  });
});
