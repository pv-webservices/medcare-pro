import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const pageSource = readFileSync(
  resolve("src/app/owner/applications/[id]/page.tsx"),
  "utf8",
);
const decisionPanelSource = readFileSync(
  resolve("src/components/owner/DecisionPanel.tsx"),
  "utf8",
);

describe("Superadmin Clinic Application Review / Detail Page Redesign", () => {
  it("renders back link and header with status badge and plan & entitlements link", () => {
    expect(pageSource).toContain("Back to applications");
    expect(pageSource).toContain("Plan and entitlements");
    expect(pageSource).toContain("Registered on");
  });

  it("renders a 2-column responsive desktop layout", () => {
    expect(pageSource).toContain("grid grid-cols-1 lg:grid-cols-12 gap-5 items-start");
    expect(pageSource).toContain("lg:col-span-7");
    expect(pageSource).toContain("lg:col-span-5");
  });

  it("renders Application summary card with all standard fields", () => {
    expect(pageSource).toContain("Application summary");
    expect(pageSource).toContain("Applicant");
    expect(pageSource).toContain("Login email");
    expect(pageSource).toContain("City");
    expect(pageSource).toContain("Phone");
    expect(pageSource).toContain("Address");
    expect(pageSource).toContain("Business contact email");
    expect(pageSource).toContain("Email verified");
    expect(pageSource).toContain("Terms accepted");
    expect(pageSource).toContain("Plan");
    expect(pageSource).toContain("Logins");
  });

  it("renders DecisionPanel with 3 selectable cards, reason character counter, and info callout", () => {
    expect(decisionPanelSource).toContain("Make a decision");
    expect(decisionPanelSource).toContain("Approve");
    expect(decisionPanelSource).toContain("Suspend");
    expect(decisionPanelSource).toContain("Reject");
    expect(decisionPanelSource).toContain("Reason");
    expect(decisionPanelSource).toContain("MAX_REASON_LENGTH");
    expect(decisionPanelSource).toContain("Approving this application will activate the clinic");
  });

  it("renders Decision history card with timeline items and activity log link", () => {
    expect(pageSource).toContain("Decision history");
    expect(pageSource).toContain("Current");
    expect(pageSource).toContain("View all activity log");
    expect(pageSource).toContain('href="/owner/audit"');
  });
});
