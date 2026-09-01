import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const pageSource = readFileSync(
  resolve("src/app/owner/applications/page.tsx"),
  "utf8",
);

describe("Superadmin Clinic Applications Page Redesign", () => {
  it("renders breadcrumbs back link to platform overview", () => {
    expect(pageSource).toContain('href="/owner/dashboard"');
    expect(pageSource).toContain("Platform overview");
  });

  it("renders compact status tabs for all 5 lifecycle statuses with count badges", () => {
    expect(pageSource).toContain("Awaiting approval");
    expect(pageSource).toContain("Active");
    expect(pageSource).toContain("Suspended");
    expect(pageSource).toContain("Rejected");
    expect(pageSource).toContain("Archived");
    expect(pageSource).toContain("counts[tab.status]");
  });

  it("renders search toolbar with search input, more filters, and search button", () => {
    expect(pageSource).toContain('placeholder="Search by clinic name, email or city"');
    expect(pageSource).toContain("More filters");
    expect(pageSource).toContain("Search");
  });

  it("renders results header with application count and sort indicator", () => {
    expect(pageSource).toContain("application");
    expect(pageSource).toContain("Sort by:");
    expect(pageSource).toContain("Newest first");
  });

  it("renders structured application cards with clinic info, metadata, and review link", () => {
    expect(pageSource).toContain("application.clinicName");
    expect(pageSource).toContain("application.email");
    expect(pageSource).toContain("Email unverified");
    expect(pageSource).toContain("Submitted");
    expect(pageSource).toContain("Review application");
    expect(pageSource).toContain("formatSubmittedAt");
  });

  it("defines semantic status styles matching the dark theme design", () => {
    expect(pageSource).toContain("border-amber-500/30 bg-amber-950/60 text-amber-300");
    expect(pageSource).toContain("border-emerald-500/30 bg-emerald-950/60 text-emerald-300");
    expect(pageSource).toContain("border-blue-500/30 bg-blue-950/60 text-blue-300");
    expect(pageSource).toContain("border-rose-500/30 bg-rose-950/60 text-rose-300");
    expect(pageSource).toContain("border-slate-700/60 bg-slate-900/60 text-slate-400");
  });

  it("provides aligned pagination footer with page navigation", () => {
    expect(pageSource).toContain("Showing");
    expect(pageSource).toContain("getPaginationPages");
    expect(pageSource).toContain("pageHref");
  });
});
