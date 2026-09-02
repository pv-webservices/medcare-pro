import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const pageSource = readFileSync(
  resolve("src/app/(dashboard)/settings/phone-menu/page.tsx"),
  "utf8",
);
const componentSource = readFileSync(
  resolve("src/components/settings/PhoneMenuEditor.tsx"),
  "utf8",
);
const landingSource = readFileSync(
  resolve("src/app/(dashboard)/settings/page.tsx"),
  "utf8",
);
const navSource = readFileSync(
  resolve("src/components/settings/SettingsNav.tsx"),
  "utf8",
);
const contractSource = readFileSync(
  resolve("src/lib/telephony/ivrProfileContract.ts"),
  "utf8",
);

describe("Phone menu settings page contract", () => {
  it("uses centralized Settings navigation and landing metadata", () => {
    expect(landingSource).toContain('"/settings/phone-menu"');
    expect(landingSource).toContain("icon: PhoneCall");
    expect(navSource).toContain("SettingsNav");
    expect(navSource).not.toContain("/settings/phone-menu");
  });

  it("enforces module and selected-clinic edit authority before profile loading", () => {
    expect(pageSource).toContain("moduleLock(actor, MODULE_FEATURES.clinics)");
    expect(pageSource).toContain('can(actor, "clinic:edit", clinicId)');
    expect(pageSource.indexOf('can(actor, "clinic:edit", clinicId)')).toBeLessThan(
      pageSource.indexOf("getClinicIvrProfileForActor(actor, clinicId)"),
    );
  });

  it("uses the trusted ClinicSwitcher selection and handles All clinics", () => {
    expect(pageSource).toContain("resolveSelectedClinicId(actor)");
    expect(pageSource).toContain("clinics.length === 1 ? clinics[0].id : null");
    expect(pageSource).toContain(
      "Select a clinic in the sidebar to configure its phone menu.",
    );
    expect(pageSource).toContain("key={clinic.id}");
    expect(componentSource).toContain("profileToPhoneMenuDraft(initialProfile)");
  });

  it("does not load or expose a profile for a selected clinic without edit authority", () => {
    expect(pageSource).toContain(
      "You don&apos;t have permission to change this clinic&apos;s phone menu.",
    );
    expect(pageSource).not.toMatch(/plivoNumber|authToken|webhookUrl|receptionPhoneNumber/);
    expect(componentSource).not.toMatch(/plivoNumber|authToken|webhookUrl|receptionPhoneNumber/);
  });

  it("uses explicit full-profile PUT and clinic-scoped DELETE with no autosave", () => {
    expect(componentSource).toContain('method: "PUT"');
    expect(componentSource).toContain('method: "DELETE"');
    expect(componentSource).toContain("Save phone menu");
    expect(componentSource).not.toContain("useDebounce");
    expect(componentSource).not.toContain("tenantId");
    expect(componentSource).not.toContain("profileId");
    expect(componentSource).toContain("if (isBusy || !dirty || !validation.valid) return");
    expect(componentSource).toContain("hydrate(body.data)");
    expect(componentSource).toContain("Your changes are still here.");
    expect(componentSource).toContain("apiErrorMessage(response.status, body.error)");
  });

  it("requires confirmation and explains reset does not change routing", () => {
    expect(componentSource).toContain("<ConfirmDialog");
    expect(componentSource).toContain("Reset phone menu to default?");
    expect(componentSource).toContain(
      "This does not disable telephony or change Auto, Reception, or IVR routing.",
    );
    expect(componentSource).toContain('if (isBusy || profile.source !== "custom") return');
    expect(componentSource).toContain("The custom menu is unchanged.");
  });

  it("keeps the caller preview text-only and safe", () => {
    expect(componentSource).toContain("Caller hears");
    expect(componentSource).toContain("No call or audio is generated.");
    expect(componentSource).not.toContain("dangerouslySetInnerHTML");
    expect(componentSource).not.toContain("speechSynthesis");
    expect(componentSource).not.toContain("<audio");
  });

  it("keeps the browser contract free of server-only dependencies", () => {
    expect(contractSource).not.toContain("@/lib/prisma");
    expect(contractSource).not.toContain("@prisma/client");
    expect(contractSource).not.toContain("@/lib/audit");
    expect(contractSource).not.toContain("next/headers");
  });

  it("has visible labels, pending semantics, keyboard ordering, and mobile-safe grids", () => {
    expect(componentSource).toContain("aria-busy={isBusy || undefined}");
    expect(componentSource).toContain("Move option ${index + 1} up");
    expect(componentSource).toContain("Move option ${index + 1} down");
    expect(componentSource).toContain("min-w-0");
    expect(componentSource).toContain("sm:grid-cols-2");
  });
});
