import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const pageSource = readFileSync(
  resolve("src/app/(dashboard)/settings/branding/page.tsx"),
  "utf8",
);
const formSource = readFileSync(
  resolve("src/components/settings/BrandingForm.tsx"),
  "utf8",
);

describe("Settings → Clinics & Branding Page", () => {
  it("renders breadcrumbs Settings > Clinics & branding", () => {
    expect(pageSource).toContain('href="/settings"');
    expect(pageSource).toContain("Clinics & branding");
  });

  it("renders Clinics & branding page heading with icon and subtitle", () => {
    expect(pageSource).toContain("Clinics & branding");
    expect(pageSource).toContain(
      "Manage this clinic&apos;s details and branding, or open organization-level clinic management.",
    );
    expect(pageSource).toContain("<BrandingForm");
  });

  it("renders 'Manage all clinics' CTA pointing to /clinics", () => {
    expect(pageSource).toContain('href="/clinics"');
    expect(pageSource).toContain("Manage all clinics");
    expect(pageSource).toContain("showManageAllClinics");
  });

  it("checks Clinics module feature lock and user permissions before showing CTA", () => {
    expect(pageSource).toContain("MODULE_FEATURES.clinics");
    expect(pageSource).toContain("moduleLock(");
    expect(pageSource).toContain("accessibleClinicScope(");
    expect(pageSource).toContain('can(actor, "clinic:create")');
  });

  it("provides actionable empty account state when user has clinic:create", () => {
    expect(pageSource).toContain(
      "No clinic has been added yet. Create your first clinic to configure its doctors, appointments, branding and operations.",
    );
    expect(pageSource).toContain("Add clinic");
  });

  it("provides organization management navigation when multiple clinics exist and none selected", () => {
    expect(pageSource).toContain(
      "Pick a clinic in the sidebar to edit its details.",
    );
  });

  it("renders a 2-column responsive layout on desktop", () => {
    expect(formSource).toContain("grid grid-cols-1 lg:grid-cols-12 gap-6 items-start");
    expect(formSource).toContain("lg:col-span-8");
    expect(formSource).toContain("lg:col-span-4");
  });

  it("renders Clinic identity card with Primary information badge and form inputs", () => {
    expect(formSource).toContain("Clinic identity");
    expect(formSource).toContain("Primary information");
    expect(formSource).toContain('id="clinic-name"');
    expect(formSource).toContain('id="clinic-address"');
    expect(formSource).toContain('id="clinic-city"');
  });

  it("renders Clinic logo section with preview, upload status, format info, and actions", () => {
    expect(formSource).toContain("Clinic logo");
    expect(formSource).toContain("Logo uploaded");
    expect(formSource).toContain("JPG or PNG");
    expect(formSource).toContain("512");
    expect(formSource).toContain("Replace logo");
    expect(formSource).toContain("Remove");
  });

  it("renders Branding tips card with three benefit items and informational callout", () => {
    expect(formSource).toContain("Branding tips");
    expect(formSource).toContain("Use a square logo");
    expect(formSource).toContain("Keep it simple");
    expect(formSource).toContain("Stay consistent");
    expect(formSource).toContain("This information is used across patient records, invoices, and reports.");
  });

  it("provides Save changes button with saving state", () => {
    expect(formSource).toContain("Save changes");
    expect(formSource).toContain("isSaving");
  });
});
