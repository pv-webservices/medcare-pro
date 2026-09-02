import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const page = readFileSync(
  resolve("src/app/(dashboard)/settings/phone-settings/page.tsx"),
  "utf8",
);
const component = readFileSync(
  resolve("src/components/settings/PhoneSettingsEditor.tsx"),
  "utf8",
);
const loading = readFileSync(
  resolve("src/app/(dashboard)/settings/phone-settings/loading.tsx"),
  "utf8",
);
const landing = readFileSync(
  resolve("src/app/(dashboard)/settings/page.tsx"),
  "utf8",
);
const nav = readFileSync(
  resolve("src/components/settings/SettingsNav.tsx"),
  "utf8",
);

describe("Phone settings clinic-facing page", () => {
  it("is discovered through centralized Settings data and landing metadata", () => {
    expect(landing).toContain('"/settings/phone-settings"');
    expect(landing).toContain("icon: Clock3");
    expect(nav).not.toContain("/settings/phone-settings");
  });

  it("enforces module and selected-clinic edit authority before loading settings", () => {
    expect(page).toContain("moduleLock(actor, MODULE_FEATURES.clinics)");
    expect(page).toContain("resolveSelectedClinicId(actor)");
    expect(page).toContain('can(actor, "clinic:edit", clinicId)');
    expect(page.indexOf('can(actor, "clinic:edit", clinicId)')).toBeLessThan(
      page.indexOf("getClinicPhoneSettingsForActor(actor, clinicId)"),
    );
  });

  it("handles no clinic, All Clinics, permission denial, and clinic switching safely", () => {
    expect(page).toContain("clinics.length === 0");
    expect(page).toContain("Select a clinic in the sidebar to configure its phone settings.");
    expect(page).toContain("You don&apos;t have permission to change this clinic&apos;s phone settings.");
    expect(page).toContain("key={clinic.id}");
  });

  it("never serializes provider infrastructure into the page or editor", () => {
    const rendered = `${page}\n${component}`;
    expect(rendered).not.toMatch(
      /plivoNumber|authToken|authId|webhookUrl|signatureConfig|PLIVO_PUBLIC_WEBHOOK_ORIGIN/,
    );
    expect(component).not.toContain("/telephony\"");
    expect(component).toContain("/telephony/settings");
  });

  it("keeps call settings and business hours as explicit independent saves", () => {
    expect(component).toContain("Save call settings");
    expect(component).toContain("Save business hours");
    expect(component).toContain('method: "PATCH"');
    expect(component).toContain('method: "PUT"');
    expect(component).not.toContain("useDebounce");
    expect(component).toContain("if (pending !== null || !callDirty");
    expect(component).toContain("if (pending !== null || !hoursDirty");
  });

  it("uses seven accessible schedule controls and preserves failure drafts", () => {
    expect(component).toContain('type="time"');
    expect(component).toContain('label="Closed"');
    expect(component).toContain("Copy Monday to weekdays");
    expect(component).toContain("Your changes are still here.");
    expect(component).toContain("Your schedule is still here.");
    expect(component).toContain("sm:grid-cols-2");
    expect(component).toContain("min-w-0");
  });

  it("provides readiness, controlled testing, and contextual links without routing controls", () => {
    expect(component).toContain("Phone readiness");
    expect(component).toContain("Test phone menu");
    expect(component).toContain("Start test call");
    expect(component).toContain('href="/settings/phone-menu"');
    expect(component).toContain('href="/dashboard"');
    expect(component).not.toContain("changeRoutingMode");
    expect(component).not.toMatch(/Call me|speechSynthesis/);
  });

  it("keeps the controlled test panel masked, confirmed, pending-safe, and clinic-keyed", () => {
    expect(page).toContain("getTelephonyTestCallPanelForActor(actor, clinicId)");
    expect(page).toContain("initialTestCall={testCall}");
    expect(page).toContain("key={clinic.id}");
    expect(component).toContain("testCall.destinationLabel");
    expect(component).toContain("<ConfirmDialog");
    expect(component).toContain('isBusy={testPending}');
    expect(component).toContain("isActiveTelephonyTestCallStatus");
    expect(component).toContain("lg:grid-cols-[minmax(0,1fr)_auto]");
    expect(component).not.toMatch(/plivoNumber|providerCallUuid|providerRequestUuid/);
  });

  it("adds clinic-scoped production diagnostics without replacing Phase 5", () => {
    expect(page).toContain("getPhoneDiagnosticsForActor(actor, clinicId)");
    expect(page).toContain("initialDiagnostics={diagnostics}");
    expect(page.indexOf('can(actor, "clinic:edit", clinicId)')).toBeLessThan(
      page.indexOf("getPhoneDiagnosticsForActor(actor, clinicId)"),
    );
    expect(component).toContain('title="Phone diagnostics"');
    expect(component).toContain('title="Test phone menu"');
    expect(component.indexOf('title="Test phone menu"')).toBeLessThan(
      component.indexOf("<PhoneDiagnosticsPanel"),
    );
  });

  it("renders no-data, healthy, attention, recent masked calls, and clinic timezone safely", () => {
    expect(component).toContain('"no-data": "No recent calls"');
    expect(component).toContain('healthy: "Healthy"');
    expect(component).toContain('attention: "Needs attention"');
    expect(component).toContain("No production call activity is available yet.");
    expect(component).toContain("diagnostics.recentCalls.map");
    expect(component).toContain("call.callerLabel");
    expect(component).toContain("Times shown in {diagnostics.timezone}");
    expect(component).toContain('timeZone: timezone');
    expect(component).toContain("sm:px-5");
    expect(component).toContain("lg:grid-cols-4");
    expect(component).not.toMatch(
      /providerCallUuid|DialBLegUUID|hangupCause|rawPayload|recording|transcript/,
    );
  });

  it("renders unavailable, active, terminal, permission, and safe failure states", () => {
    expect(component).toContain("testCall.unavailableReason");
    expect(component).toContain("!testCall.available || pending !== null || testPending");
    expect(component).toContain('REQUESTED: "Starting…"');
    expect(component).toContain('RINGING: "Ringing…"');
    expect(component).toContain('ANSWERED: "Answered…"');
    expect(component).toContain('COMPLETED: "Completed"');
    expect(component).toContain('FAILED: "Failed"');
    expect(component).toContain("You don't have permission to test this clinic's phone menu.");
    expect(component).toContain("The test call could not be started. Try again later.");
  });

  it("provides a labeled loading state", () => {
    expect(loading).toContain('aria-busy="true"');
    expect(loading).toContain('aria-label="Loading phone settings"');
  });
});
