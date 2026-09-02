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

describe("Settings → Clinic Details Page Redesign", () => {
  it("renders breadcrumbs Settings > Clinic details", () => {
    expect(pageSource).toContain('href="/settings"');
    expect(pageSource).toContain("Clinic details");
  });

  it("renders Clinic details page heading with icon and subtitle", () => {
    expect(pageSource).toContain("Clinic details");
    expect(pageSource).toContain("name, address, and branding information");
    expect(pageSource).toContain("<BrandingForm");
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
