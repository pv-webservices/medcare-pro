import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { NAV_LINKS, visibleNavLinks } from "@/lib/navigation";

const page = readFileSync(resolve("src/app/(dashboard)/ivr/page.tsx"), "utf8");
const nav = readFileSync(resolve("src/components/dashboard/DashboardNav.tsx"), "utf8");
const settings = readFileSync(resolve("src/components/settings/PhoneSettingsEditor.tsx"), "utf8");
const testPanel = readFileSync(resolve("src/components/ivr/PhoneMenuTestPanel.tsx"), "utf8");
const diagnostics = readFileSync(resolve("src/components/ivr/PhoneDiagnosticsPanel.tsx"), "utf8");

describe("top-level IVR workspace", () => {
  it("is feature-gated and discoverable through either meaningful permission", () => {
    const link = NAV_LINKS.find((item) => item.href === "/ivr");
    expect(link).toEqual({
      href: "/ivr",
      label: "IVR",
      permission: ["appointment:create", "clinic:edit"],
      feature: "ivr",
    });
    expect(visibleNavLinks((permission) => permission === "appointment:create", () => true)).toContain(link);
    expect(visibleNavLinks((permission) => permission === "clinic:edit", () => true)).toContain(link);
    expect(visibleNavLinks(() => true, (feature) => feature !== "ivr")).not.toContain(link);
    expect(nav).toContain('"/ivr": PhoneCall');
    expect(nav.indexOf('"/messages"')).toBeLessThan(nav.indexOf('"/ivr"'));
  });

  it("uses trusted selected-clinic resolution and independently gates sections", () => {
    expect(page).toContain("requireActor()");
    expect(page).toContain("moduleLock(actor, MODULE_FEATURES.ivr)");
    expect(page).toContain("resolveSelectedClinicId(actor)");
    expect(page).toContain("listClinicsForActor(actor)");
    expect(page).toContain('holdsAnywhere(held, "appointment:create")');
    expect(page).toContain('can(actor, "clinic:edit", clinic.id)');
    expect(page).toContain("getBookingFollowUpsForActor(actor, selectedClinicId)");
    expect(page.indexOf("canManageSelectedTelephony && clinic")).toBeLessThan(
      page.indexOf("getPhoneDiagnosticsForActor(actor, clinic.id, now)"),
    );
  });

  it("handles single-clinic, All clinics, and no-clinic operational states", () => {
    expect(page).toContain("clinics.length === 1 ? clinics[0].id : null");
    expect(page).toContain('scope={clinic?.name ?? "All clinics"}');
    expect(page).toContain("Select a clinic to view readiness, run a phone-menu test and inspect call diagnostics.");
    expect(page).toContain("No accessible clinic is available for telephone operations.");
  });

  it("renders sections in the required order and leaves editors in Settings", () => {
    const overview = page.indexOf("IVR operational overview");
    const followUps = page.indexOf("<BookingFollowUpsPanel");
    const readiness = page.indexOf("<PhoneReadinessPanel");
    const test = page.indexOf("<PhoneMenuTestPanel");
    const diagnosticPanel = page.indexOf("<PhoneDiagnosticsPanel");
    expect(overview).toBeLessThan(followUps);
    expect(followUps).toBeLessThan(readiness);
    expect(readiness).toBeLessThan(test);
    expect(test).toBeLessThan(diagnosticPanel);
    expect(page).toContain('href="/settings/phone-settings"');
    expect(page).toContain('href="/settings/phone-menu"');
    expect(settings).not.toMatch(/Phone readiness|Test phone menu|Phone diagnostics/);
  });

  it("preserves test-call polling, confirmation, and safety restrictions", () => {
    expect(testPanel).toContain("/telephony/test-call/${encodeURIComponent(attempt.id)}");
    expect(testPanel).toContain('method: "POST"');
    expect(testPanel).toContain("setTimeout(poll, 2_000)");
    expect(testPanel).toContain("setTimeout(poll, 4_000)");
    expect(testPanel).toContain("<ConfirmDialog");
    expect(testPanel).toContain("limited to two minutes");
    expect(testPanel).toContain("will not book appointments or transfer callers");
    expect(testPanel).not.toMatch(/providerCallUuid|providerRequestUuid|authToken|authId/);
  });

  it("keeps diagnostics privacy-bounded and canonical call links intact", () => {
    expect(diagnostics).toContain("diagnostics.recentCalls.map");
    expect(diagnostics).toContain("href={`tel:${call.callerNumber}`}");
    expect(diagnostics).toContain("{call.callerLabel}");
    expect(diagnostics).toContain("Recent activity");
    expect(diagnostics).not.toMatch(/providerCallUuid|DialBLegUUID|rawPayload|recording|transcript|authToken/);
  });
});
