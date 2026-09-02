import { describe, expect, it } from "vitest";
import { NAV_LINKS, visibleNavLinks } from "@/lib/navigation";
import { ALL_PERMISSIONS, findPermission } from "@/lib/permissions";
import {
  SETTINGS_SECTIONS,
  SETTINGS_VIEW_PERMISSIONS,
  canManageSection,
  visibleSettingsSections,
} from "@/lib/settingsSections";

/**
 * The Settings section — Stage 10.
 *
 * The failures this catches are all silent ones: a section listed with a
 * permission the catalogue does not define, a sidebar tab nobody can reach, a
 * screen offered on the landing page that its own gate would refuse, and — the
 * one that matters most — a role that could reach branding yesterday and cannot
 * today.
 */

const holder =
  (...permissions: string[]) =>
  (permission: string) =>
    permissions.includes(permission);

const OWNER = () => true;
const NOBODY = () => false;

describe("SETTINGS_SECTIONS", () => {
  it("names only permissions the catalogue defines", () => {
    // A typo here does not throw. It just produces a section nobody can open,
    // or one anybody can.
    for (const section of SETTINGS_SECTIONS) {
      for (const permission of [
        ...section.viewPermissions,
        ...section.managePermissions,
      ]) {
        expect(ALL_PERMISSIONS).toContain(permission);
      }
    }
  });

  it("gives every section at least one way in", () => {
    for (const section of SETTINGS_SECTIONS) {
      expect(section.viewPermissions.length).toBeGreaterThan(0);
    }
  });

  it("leaves manage permissions empty only where nothing CAN be changed", () => {
    // Stage 11 added the activity log, which is append-only — no permission
    // makes it editable, so it correctly reads "View only" for everyone. Every
    // other section must offer a way to change it, or its landing-page label is
    // wrong.
    const readOnly = SETTINGS_SECTIONS.filter(
      (section) => section.managePermissions.length === 0,
    ).map((section) => section.href);
    expect(readOnly).toEqual(["/settings/audit"]);
  });

  it("never opens a section on a permission the screen behind it would refuse", () => {
    // The landing page must not offer a card that leads to "your role cannot
    // view this". So viewPermissions has to match what each screen ACTUALLY
    // accepts, which is not always the tidy superset one would design:
    //
    //   /settings/roles     getRolesOverview requires role:read
    //   /settings/features  getFeatureOverview requires feature:view
    //   /settings/branding  the page itself folds this very list
    //
    // `role:manage` and `feature:manage` are therefore NOT listed as view
    // permissions, even though they are manage permissions. A role holding one
    // without its read counterpart reaches nothing today — a pre-existing
    // property of those two screens, not something Stage 10 introduced, and
    // pinned here so that changing either gate is a deliberate act.
    expect(
      SETTINGS_SECTIONS.find((section) => section.href === "/settings/roles")
        ?.viewPermissions,
    ).toEqual(["role:read"]);
    expect(
      SETTINGS_SECTIONS.find((section) => section.href === "/settings/features")
        ?.viewPermissions,
    ).toEqual(["feature:view"]);
    expect(
      SETTINGS_SECTIONS.find((section) => section.href === "/settings/phone-menu")
        ?.viewPermissions,
    ).toEqual(["clinic:edit"]);
  });

  it("describes every section without a placeholder", () => {
    for (const section of SETTINGS_SECTIONS) {
      expect(section.title.length).toBeGreaterThan(0);
      expect(section.description.length).toBeGreaterThan(20);
      expect(section.href.startsWith("/settings/")).toBe(true);
    }
  });

  it("has no duplicate hrefs", () => {
    const hrefs = SETTINGS_SECTIONS.map((section) => section.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });
});

describe("who reaches what", () => {
  it("shows an account owner everything, and lets them change all but the log", () => {
    const visible = visibleSettingsSections(OWNER);
    expect(visible).toHaveLength(SETTINGS_SECTIONS.length);

    for (const section of visible) {
      // The activity log is append-only. Not even the wildcard makes it
      // editable, which is the point: an audit trail an owner can rewrite is
      // not an audit trail. Everything else must be theirs to change.
      const expected = section.href !== "/settings/audit";
      expect(canManageSection(section, OWNER)).toBe(expected);
    }
  });

  it("shows a role with nothing no sections at all", () => {
    expect(visibleSettingsSections(NOBODY)).toHaveLength(0);
  });

  it("shows the roles screen to role:read, and nothing else", () => {
    const visible = visibleSettingsSections(holder("role:read"));
    expect(visible.map((section) => section.href)).toEqual(["/settings/roles"]);
    expect(canManageSection(visible[0], holder("role:read"))).toBe(false);
  });

  it("keeps view and change apart on every section", () => {
    for (const section of SETTINGS_SECTIONS.filter(
      (candidate) => candidate.href !== "/settings/phone-menu",
    )) {
      const viewerOnly = holder(...section.viewPermissions.filter(
        (permission) => !section.managePermissions.includes(permission),
      ));
      // Every section has at least one view-only permission, or the distinction
      // the landing page draws ("View only" vs "You can change this") would be
      // decorative for it.
      expect(visibleSettingsSections(viewerOnly)).toContain(section);
      expect(canManageSection(section, viewerOnly)).toBe(false);
    }
  });

  it("advertises Phone menu only at the existing telephony-management boundary", () => {
    const phoneMenu = SETTINGS_SECTIONS.find(
      (section) => section.href === "/settings/phone-menu",
    )!;
    expect(visibleSettingsSections(holder("clinic:edit"))).toContain(phoneMenu);
    expect(canManageSection(phoneMenu, holder("clinic:edit"))).toBe(true);
    for (const permission of ["settings:view", "settings:manage", "clinic:read"]) {
      expect(visibleSettingsSections(holder(permission))).not.toContain(phoneMenu);
    }
  });
});

describe("branding loses nobody", () => {
  const branding = SETTINGS_SECTIONS.find(
    (section) => section.href === "/settings/branding",
  )!;

  it("still opens for a role holding only the clinic permissions", () => {
    // The whole reason viewPermissions is a list. Before Stage 10 the branding
    // page had no gate of its own and clinic:edit decided whether the form was
    // live; gating it on settings:* alone would have removed the screen from
    // every custom role that had never heard of those keys.
    expect(visibleSettingsSections(holder("clinic:read"))).toContain(branding);
    expect(visibleSettingsSections(holder("clinic:edit"))).toContain(branding);
  });

  it("still lets clinic:edit save, exactly as it did before", () => {
    expect(canManageSection(branding, holder("clinic:edit"))).toBe(true);
  });

  it("does not let clinic:read save", () => {
    expect(canManageSection(branding, holder("clinic:read"))).toBe(false);
  });

  it("gives the two settings keys real, separate meanings", () => {
    // A catalogue string no call site checks grants nothing — lib/permissions.ts
    // says so, and these two sat that way from Stage 1 until now.
    expect(visibleSettingsSections(holder("settings:view"))).toContain(branding);
    expect(canManageSection(branding, holder("settings:view"))).toBe(false);
    expect(canManageSection(branding, holder("settings:manage"))).toBe(true);
  });

  it("carries no pending mark on either key any more", () => {
    for (const key of ["settings:view", "settings:manage"]) {
      expect(findPermission(key)?.pending).toBeUndefined();
      expect(findPermission(key)?.pendingNote).toBeUndefined();
    }
  });
});

describe("the sidebar's Settings tab", () => {
  const tab = NAV_LINKS.find((link) => link.href === "/settings")!;

  it("exists, and is the only settings entry", () => {
    expect(tab).toBeDefined();
    const settingsTabs = NAV_LINKS.filter((link) =>
      link.href.startsWith("/settings"),
    );
    expect(settingsTabs).toHaveLength(1);
  });

  it("is gated on every permission that opens any section, and no others", () => {
    expect([...(tab.permission as readonly string[])].sort()).toEqual(
      [...SETTINGS_VIEW_PERMISSIONS].sort(),
    );
  });

  it("appears for anyone who can open at least one section", () => {
    for (const section of SETTINGS_SECTIONS) {
      for (const permission of section.viewPermissions) {
        const links = visibleNavLinks(holder(permission));
        expect(links.map((link) => link.href)).toContain("/settings");
      }
    }
  });

  it("is hidden from someone who can open none of them", () => {
    // The permission that gates Registrations, chosen because it is the one a
    // front-desk role holds and none of the settings screens accept.
    const links = visibleNavLinks(holder("registration:create"));
    expect(links.map((link) => link.href)).not.toContain("/settings");
  });

  it("lists each permission once", () => {
    const listed = tab.permission as readonly string[];
    expect(new Set(listed).size).toBe(listed.length);
  });
});
