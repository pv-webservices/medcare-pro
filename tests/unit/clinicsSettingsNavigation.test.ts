import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SETTINGS_SECTIONS } from "@/lib/settingsSections";

describe("Clinics & Branding Navigation Architecture", () => {
  const brandingSection = SETTINGS_SECTIONS.find(
    (s) => s.href === "/settings/branding",
  );

  it("retains href /settings/branding with title 'Clinics & branding'", () => {
    expect(brandingSection).toBeDefined();
    expect(brandingSection?.title).toBe("Clinics & branding");
    expect(brandingSection?.href).toBe("/settings/branding");
    expect(brandingSection?.description).toBe(
      "Manage the selected clinic's details and branding, or manage all clinics in your organization.",
    );
  });

  it("preserves compatibility view and manage permissions without widening or narrowing", () => {
    expect(brandingSection?.viewPermissions).toEqual([
      "settings:view",
      "settings:manage",
      "clinic:read",
      "clinic:edit",
    ]);
    expect(brandingSection?.managePermissions).toEqual([
      "settings:manage",
      "clinic:edit",
    ]);
  });

  it("updates Settings landing card display description", () => {
    const settingsPageSource = readFileSync(
      resolve("src/app/(dashboard)/settings/page.tsx"),
      "utf8",
    );
    expect(settingsPageSource).toContain('"/settings/branding"');
    expect(settingsPageSource).toContain(
      "Update the selected clinic's details and branding, or manage all clinics in your organization.",
    );
  });

  it("configures breadcrumb and heading on /settings/branding", () => {
    const pageSource = readFileSync(
      resolve("src/app/(dashboard)/settings/branding/page.tsx"),
      "utf8",
    );
    expect(pageSource).toContain('href="/settings"');
    expect(pageSource).toContain("Clinics & branding");
    expect(pageSource).toContain(
      "Manage this clinic&apos;s details and branding, or open organization-level clinic management.",
    );
  });

  it("gates 'Manage all clinics' CTA on Clinics module lock and tenant-wide management authority", () => {
    const pageSource = readFileSync(
      resolve("src/app/(dashboard)/settings/branding/page.tsx"),
      "utf8",
    );

    // Verifies module feature lock check
    expect(pageSource).toContain("moduleLock(actor, MODULE_FEATURES.clinics)");

    // Verifies scope check
    expect(pageSource).toContain('accessibleClinicScope(actor, "clinic:read")');

    // Verifies tenant-wide clinic creation check
    expect(pageSource).toContain('can(actor, "clinic:create")');

    // Verifies CTA conditions
    expect(pageSource).toContain("showManageAllClinics");
    expect(pageSource).toContain("showViewScopedClinics");
    expect(pageSource).toContain('href="/clinics"');
  });

  it("provides return path from /clinics back to Settings", () => {
    const clinicsPageSource = readFileSync(
      resolve("src/app/(dashboard)/clinics/page.tsx"),
      "utf8",
    );
    const addClinicPanelSource = readFileSync(
      resolve("src/components/clinics/AddClinicPanel.tsx"),
      "utf8",
    );

    expect(clinicsPageSource).toContain(
      'back={{ href: "/settings/branding", label: "Clinics & branding" }}',
    );
    expect(addClinicPanelSource).toContain("back = { href: \"/settings/branding\", label: \"Clinics & branding\" }");
  });

  describe("CTA display predicate simulation", () => {
    function computeCtaState({
      isClinicsModuleUnlocked,
      readScope,
      canCreateClinic,
      canEditClinic,
      settingsManage,
    }: {
      isClinicsModuleUnlocked: boolean;
      readScope: { scope: "all" | "clinics" | "none"; clinicIds?: string[] };
      canCreateClinic: boolean;
      canEditClinic: boolean;
      settingsManage: boolean;
    }) {
      const canManageAnywhere =
        canEditClinic || settingsManage || canCreateClinic;

      const showManageAllClinics =
        isClinicsModuleUnlocked &&
        readScope.scope === "all" &&
        canManageAnywhere;

      const showViewScopedClinics =
        !showManageAllClinics &&
        isClinicsModuleUnlocked &&
        readScope.scope === "clinics" &&
        (readScope.clinicIds?.length ?? 0) > 1 &&
        canManageAnywhere;

      return { showManageAllClinics, showViewScopedClinics };
    }

    it("shows 'Manage all clinics' for Owner", () => {
      const result = computeCtaState({
        isClinicsModuleUnlocked: true,
        readScope: { scope: "all" },
        canCreateClinic: true,
        canEditClinic: true,
        settingsManage: true,
      });
      expect(result.showManageAllClinics).toBe(true);
      expect(result.showViewScopedClinics).toBe(false);
    });

    it("shows 'Manage all clinics' for Tenant-wide Admin", () => {
      const result = computeCtaState({
        isClinicsModuleUnlocked: true,
        readScope: { scope: "all" },
        canCreateClinic: true,
        canEditClinic: true,
        settingsManage: true,
      });
      expect(result.showManageAllClinics).toBe(true);
      expect(result.showViewScopedClinics).toBe(false);
    });

    it("shows 'View clinics' for multi-clinic scoped manager", () => {
      const result = computeCtaState({
        isClinicsModuleUnlocked: true,
        readScope: { scope: "clinics", clinicIds: ["clinic-1", "clinic-2"] },
        canCreateClinic: false,
        canEditClinic: true,
        settingsManage: false,
      });
      expect(result.showManageAllClinics).toBe(false);
      expect(result.showViewScopedClinics).toBe(true);
    });

    it("omits organization CTA for single-clinic scoped manager", () => {
      const result = computeCtaState({
        isClinicsModuleUnlocked: true,
        readScope: { scope: "clinics", clinicIds: ["clinic-1"] },
        canCreateClinic: false,
        canEditClinic: true,
        settingsManage: false,
      });
      expect(result.showManageAllClinics).toBe(false);
      expect(result.showViewScopedClinics).toBe(false);
    });

    it("omits management CTA for Doctor without clinic-management permissions", () => {
      const result = computeCtaState({
        isClinicsModuleUnlocked: true,
        readScope: { scope: "clinics", clinicIds: ["clinic-1", "clinic-2"] },
        canCreateClinic: false,
        canEditClinic: false,
        settingsManage: false,
      });
      expect(result.showManageAllClinics).toBe(false);
      expect(result.showViewScopedClinics).toBe(false);
    });

    it("omits management CTA for Staff without clinic-management permissions", () => {
      const result = computeCtaState({
        isClinicsModuleUnlocked: true,
        readScope: { scope: "all" },
        canCreateClinic: false,
        canEditClinic: false,
        settingsManage: false,
      });
      expect(result.showManageAllClinics).toBe(false);
      expect(result.showViewScopedClinics).toBe(false);
    });

    it("omits all CTAs when Clinics module is locked by feature entitlements", () => {
      const result = computeCtaState({
        isClinicsModuleUnlocked: false,
        readScope: { scope: "all" },
        canCreateClinic: true,
        canEditClinic: true,
        settingsManage: true,
      });
      expect(result.showManageAllClinics).toBe(false);
      expect(result.showViewScopedClinics).toBe(false);
    });
  });
});
