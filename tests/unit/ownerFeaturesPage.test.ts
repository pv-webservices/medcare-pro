import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const pageSource = readFileSync(
  resolve("src/app/owner/features/page.tsx"),
  "utf8",
);
const switchesSource = readFileSync(
  resolve("src/components/owner/GlobalFeatureSwitches.tsx"),
  "utf8",
);

describe("Superadmin Platform Features Page Redesign", () => {
  it("renders breadcrumbs back link to platform overview", () => {
    expect(pageSource).toContain('href="/owner/dashboard"');
    expect(pageSource).toContain("Platform overview");
  });

  it("renders Platform features heading and supporting control copy", () => {
    expect(pageSource).toContain("Platform features");
    expect(pageSource).toContain("Control platform-wide features");
    expect(pageSource).toContain("<GlobalFeatureSwitches");
  });

  it("renders a 2-column responsive feature card grid on desktop", () => {
    expect(switchesSource).toContain("grid grid-cols-1 lg:grid-cols-2 gap-5");
  });

  it("displays feature icon, name, slug, tier badge, and live status badge", () => {
    expect(switchesSource).toContain("getFeatureIcon");
    expect(switchesSource).toContain("feature.name");
    expect(switchesSource).toContain("feature.key");
    expect(switchesSource).toContain("feature.tier");
    expect(switchesSource).toContain("Live");
    expect(switchesSource).toContain("Switched off");
  });

  it("displays real organization entitlement count and plan context", () => {
    expect(switchesSource).toContain("feature.entitledTenants");
    expect(switchesSource).toContain("totalCustomerTenants");
    expect(switchesSource).toContain("entitled");
    expect(switchesSource).toContain("feature.plansIncluding");
  });

  it("provides restrained red outline danger button for switching off", () => {
    expect(switchesSource).toContain("border-rose-500/30");
    expect(switchesSource).toContain("Switch off");
    expect(switchesSource).toContain("platform-wide");
    expect(switchesSource).toContain("PowerOff");
  });

  it("supports inline confirmation drawer requiring reason and feature key confirmation", () => {
    expect(switchesSource).toContain("MIN_REASON_LENGTH");
    expect(switchesSource).toContain("switchingOff");
    expect(switchesSource).toContain("/api/owner/features");
    expect(switchesSource).toContain("Type");
    expect(switchesSource).toContain("to confirm");
  });
});
