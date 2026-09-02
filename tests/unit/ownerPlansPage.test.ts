import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const pageSource = readFileSync(
  resolve("src/app/owner/plans/page.tsx"),
  "utf8",
);
const editorSource = readFileSync(
  resolve("src/components/owner/PlanFeatureEditor.tsx"),
  "utf8",
);

describe("Superadmin Plans Page Redesign", () => {
  it("renders breadcrumbs back link to platform overview", () => {
    expect(pageSource).toContain('href="/owner/dashboard"');
    expect(pageSource).toContain("Platform overview");
  });

  it("renders Plans heading and explanatory second layer copy", () => {
    expect(pageSource).toContain("Plans");
    expect(pageSource).toContain("The second layer.");
    expect(pageSource).toContain("<PlanFeatureEditor");
  });

  it("renders prominent plan summary card with icon, active badge, and organization count", () => {
    expect(editorSource).toContain("<Layers");
    expect(editorSource).toContain("Active plan");
    expect(editorSource).toContain("on this plan");
    expect(editorSource).toContain("plan.tenantCount");
  });

  it("renders full-width structured features table with correct columns", () => {
    expect(editorSource).toContain("<table");
    expect(editorSource).toContain("Feature");
    expect(editorSource).toContain("Slug");
    expect(editorSource).toContain("Status");
    expect(editorSource).toContain("Action");
  });

  it("renders semantic status badges and action buttons", () => {
    expect(editorSource).toContain("Included");
    expect(editorSource).toContain("Not included");
    expect(editorSource).toContain("Remove from plan");
    expect(editorSource).toContain("Add to plan");
  });

  it("maps feature icons cleanly for platform features", () => {
    expect(editorSource).toContain("getFeatureIcon");
    expect(editorSource).toContain("Building2");
    expect(editorSource).toContain("UserRound");
    expect(editorSource).toContain("Bell");
    expect(editorSource).toContain("Calendar");
  });

  it("supports inline confirmation drawer with reason input and validation", () => {
    expect(editorSource).toContain("MIN_REASON_LENGTH");
    expect(editorSource).toContain("isRemoval");
    expect(editorSource).toContain("Confirm & remove from plan");
    expect(editorSource).toContain("Confirm & add to plan");
    expect(editorSource).toContain("/api/owner/plans");
  });
});
