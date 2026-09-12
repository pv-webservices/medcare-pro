import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { FeatureOverviewRow } from "@/lib/features";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
  }),
}));

vi.mock("@/components/ui/Toast", () => ({
  useToast: () => vi.fn(),
}));

import FeatureMatrix from "@/components/settings/FeatureMatrix";

const MOCK_FEATURES: FeatureOverviewRow[] = [
  {
    key: "appointments",
    name: "Appointments",
    description: "Book, reschedule and cancel appointments.",
    tier: "CORE",
    isEntitled: true,
    entitlementSource: "plan",
    isUngated: false,
    ungatedNote: null,
    inheritsWhenSilent: true,
    roles: [
      {
        roleId: "role-owner",
        roleName: "Account Owner",
        isAccountOwner: true,
        access: null,
        isEffective: true,
        isEditable: false,
      },
      {
        roleId: "role-doctor",
        roleName: "Doctor",
        isAccountOwner: false,
        access: true, // explicitly ON for appointments
        isEffective: true,
        isEditable: true,
      },
      {
        roleId: "role-reception",
        roleName: "Receptionist",
        isAccountOwner: false,
        access: false, // explicitly OFF for appointments
        isEffective: false,
        isEditable: true,
      },
    ],
  },
  {
    key: "reports",
    name: "Reports",
    description: "Export financial and operational reports.",
    tier: "PREMIUM",
    isEntitled: true,
    entitlementSource: "plan",
    isUngated: false,
    ungatedNote: null,
    inheritsWhenSilent: false,
    roles: [
      {
        roleId: "role-owner",
        roleName: "Account Owner",
        isAccountOwner: true,
        access: null,
        isEffective: true,
        isEditable: false,
      },
      {
        roleId: "role-doctor",
        roleName: "Doctor",
        isAccountOwner: false,
        access: false, // explicitly OFF for reports (different from appointments!)
        isEffective: false,
        isEditable: true,
      },
      {
        roleId: "role-reception",
        roleName: "Receptionist",
        isAccountOwner: false,
        access: true, // explicitly ON for reports (different from appointments!)
        isEffective: true,
        isEditable: true,
      },
    ],
  },
  {
    key: "marketing",
    name: "Marketing",
    description: "Run patient outreach campaigns.",
    tier: "CORE",
    isEntitled: false,
    entitlementSource: "not-in-plan",
    isUngated: false,
    ungatedNote: null,
    inheritsWhenSilent: true,
    roles: [
      {
        roleId: "role-owner",
        roleName: "Account Owner",
        isAccountOwner: true,
        access: null,
        isEffective: true,
        isEditable: false,
      },
      {
        roleId: "role-doctor",
        roleName: "Doctor",
        isAccountOwner: false,
        access: null,
        isEffective: false,
        isEditable: false,
      },
      {
        roleId: "role-reception",
        roleName: "Receptionist",
        isAccountOwner: false,
        access: null,
        isEffective: false,
        isEditable: false,
      },
    ],
  },
];

describe("FeatureMatrix row binding and role state isolation", () => {
  it("renders feature-specific role states for each row independently", () => {
    const html = renderToStaticMarkup(
      createElement(FeatureMatrix, {
        features: MOCK_FEATURES,
        canManage: true,
      }),
    );

    // Guidance banner linking to /settings/roles is present
    expect(html).toContain("Access vs. Permissions:");
    expect(html).toContain("/settings/roles");

    // Check headers display distinct roles
    expect(html).toContain("Account Owner");
    expect(html).toContain("Doctor");
    expect(html).toContain("Receptionist");
    expect(html).toContain("Account owner — always on");

    // Check features are rendered
    expect(html).toContain("Appointments");
    expect(html).toContain("Reports");
    expect(html).toContain("Marketing");

    // Labels for the dropdown controls must be specific to each feature row
    expect(html).toContain('aria-label="Appointments access for Doctor"');
    expect(html).toContain('aria-label="Reports access for Doctor"');
    expect(html).toContain('aria-label="Appointments access for Receptionist"');
    expect(html).toContain('aria-label="Reports access for Receptionist"');

    // Doctor has access on Appointments but NOT on Reports
    expect(html).toContain('data-feature="appointments" data-role="role-doctor" data-effective="true"');
    expect(html).toContain('data-feature="reports" data-role="role-doctor" data-effective="false"');

    // Receptionist has NO access on Appointments but HAS access on Reports
    expect(html).toContain('data-feature="appointments" data-role="role-reception" data-effective="false"');
    expect(html).toContain('data-feature="reports" data-role="role-reception" data-effective="true"');

    // Account Owner is always on and locked
    expect(html).toContain("Always on");

    // For not included features, check the callout is rendered
    expect(html).toContain("Not available within organization.");
  });

  it("renders read-only display badges when actor cannot manage features", () => {
    const html = renderToStaticMarkup(
      createElement(FeatureMatrix, {
        features: MOCK_FEATURES,
        canManage: false,
      }),
    );

    // No interactive menu controls or dropdown labels
    expect(html).not.toContain('aria-label="Appointments access for Doctor"');
    expect(html).not.toContain('aria-label="Reports access for Doctor"');

    // Static badges still show the effective status
    expect(html).toContain("Can use");
    expect(html).toContain("Cannot use");
  });

  it("safely handles empty feature list", () => {
    const html = renderToStaticMarkup(
      createElement(FeatureMatrix, {
        features: [],
        canManage: true,
      }),
    );

    expect(html).toContain("Total features");
    expect(html).toContain("No features found");
  });
});
