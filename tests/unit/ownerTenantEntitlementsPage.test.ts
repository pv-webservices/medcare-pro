import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const pageSource = readFileSync(
  resolve("src/app/owner/applications/[id]/entitlements/page.tsx"),
  "utf8",
);
const panelSource = readFileSync(
  resolve("src/components/owner/TenantEntitlementsPanel.tsx"),
  "utf8",
);

describe("Superadmin → Clinic Applications → Plan and Entitlements Page Redesign", () => {
  it("renders back link and header with plan, feature counts, and status", () => {
    expect(pageSource).toContain("Back to");
    expect(pageSource).toContain("features available to them");
    expect(pageSource).toContain("<TenantEntitlementsPanel");
  });

  it("renders a 2-column responsive desktop layout", () => {
    expect(panelSource).toContain("grid grid-cols-1 lg:grid-cols-12 gap-5 items-start");
    expect(panelSource).toContain("lg:col-span-8");
    expect(panelSource).toContain("lg:col-span-4");
  });

  it("renders Plan and entitlements card with Plan selector and 2-column feature cards grid", () => {
    expect(panelSource).toContain("Plan and entitlements");
    expect(panelSource).toContain("Features");
    expect(panelSource).toContain("grid grid-cols-1 sm:grid-cols-2 gap-2.5");
    expect(panelSource).toContain("Follows the plan");
    expect(panelSource).toContain("Override");
  });

  it("renders Reason textarea and contextual save/discard action buttons", () => {
    expect(panelSource).toContain("Reason");
    expect(panelSource).toContain("Save entitlements");
    expect(panelSource).toContain("Discard changes");
  });

  it("renders bottom informational banner about revoking features", () => {
    expect(panelSource).toContain("Revoking a feature leaves this organisation");
  });

  it("renders Entitlement summary card with dynamic statistics", () => {
    expect(panelSource).toContain("Entitlement summary");
    expect(panelSource).toContain("Total features");
    expect(panelSource).toContain("Enabled");
    expect(panelSource).toContain("Disabled");
    expect(panelSource).toContain("Following plan");
    expect(panelSource).toContain("Overrides");
  });

  it("renders educational How this works card, Clinic status, and Recent changes", () => {
    expect(panelSource).toContain("How this works");
    expect(panelSource).toContain("Plan inheritance");
    expect(panelSource).toContain("Clinic status");
    expect(panelSource).toContain("Recent changes");
  });
});
