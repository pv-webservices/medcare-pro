/**
 * The Settings section — Stage 10, PRD §6.8.
 *
 * Pure data and predicates: no Prisma, no session, so the navigation, the
 * Settings landing page and the unit tests all read the same list. A settings
 * screen that appeared on the landing page but not in the sidebar, or that the
 * landing page offered and the page itself refused, would be two descriptions
 * of one permission that had drifted apart.
 *
 * WHAT STAGE 10 IS. PRD §6.8's four requirements were built across earlier
 * stages: roles and role assignment (FR-8.1, FR-8.2), and the logo and theme
 * colour (FR-8.3, FR-8.4). What was missing was the section itself — Branding
 * was reachable only by typing its URL, and `settings:view` / `settings:manage`
 * had sat in the catalogue since Stage 1 without a single call site, which by
 * this codebase's own rule means they granted nothing.
 *
 * No new tables, no new fields, no migration. The PRD names no other setting —
 * no opening hours, no default fee, no notification preferences — and inventing
 * one here would be exactly the guess CLAUDE.md forbids.
 *
 * TWO PERMISSIONS PER SECTION, AND WHY THEY ARE LISTS. Every section separates
 * "may look" from "may change", because every one of these screens is useful
 * read-only: seeing which role holds what, seeing which features the
 * organisation is entitled to, seeing the clinic's own colour. And each is a
 * LIST folded with ANY, because more than one existing permission can honestly
 * open the same screen — see the note on Branding below.
 */

import type { ModuleFeatureKey } from "@/lib/moduleFeatures";

export interface SettingsSection {
  href: string;
  title: string;
  /** One line, in the PRD's vocabulary, saying what the screen controls. */
  description: string;
  /** ANY of these opens the section, read-only. */
  viewPermissions: readonly string[];
  /**
   * ANY of these makes its controls live.
   *
   * EMPTY IS MEANINGFUL, not an oversight: the activity log is append-only, so
   * no permission can make it editable and the landing page correctly shows it
   * as "View only" to everybody, the account owner included.
   */
  managePermissions: readonly string[];
  /** Feature gating the module, where applicable. */
  feature?: ModuleFeatureKey | null;
}

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  {
    href: "/settings/dashboard",
    title: "Dashboard",
    description:
      "Arrange your dashboard and, when authorized, configure defaults for lower-authority roles.",
    viewPermissions: ["dashboard:view", "dashboard:customize", "dashboard:layout:manage"],
    managePermissions: ["dashboard:customize", "dashboard:layout:manage"],
  },
  {
    href: "/settings/roles",
    title: "Roles & permissions",
    description:
      "Create roles, choose what each one can do, and assign them to users — for the whole account or one clinic.",
    viewPermissions: ["role:read"],
    managePermissions: ["role:manage"],
  },
  {
    href: "/settings/features",
    title: "Features",
    description:
      "Which of the organisation's features each role may use. What the organisation is entitled to is set by MEDCARE PRO.",
    viewPermissions: ["feature:view"],
    managePermissions: ["feature:manage"],
  },
  {
    href: "/settings/audit",
    title: "Activity log",
    description:
      "Who did what in this organisation and when — team changes, role and feature changes, and the decisions MEDCARE PRO took about the account.",
    // Read-only by nature: the trail is append-only, so `audit:read` is both the
    // view and the "manage" permission. There is nothing to change here, and
    // listing a manage permission nothing enforces would be the hollow grant
    // lib/permissions.ts warns about — so the landing page will show this card
    // as "View only" for everyone, which is the truth.
    viewPermissions: ["audit:read"],
    managePermissions: [],
  },
  {
    href: "/settings/branding",
    title: "Clinic details",
    // Retitled when the Clinics tab was removed. This screen was already the
    // only place branding was edited; it now also carries the name, address and
    // city that the Clinics screen used to own, so "Branding" undersold it.
    // The href is deliberately unchanged — it is linked from the settings
    // landing page and appears in the audit trail, and renaming a live URL to
    // match a label buys nothing.
    description:
      "Your clinic's name, address and city, and the logo shown across the app.",
    // `clinic:read` and `clinic:edit` are listed beside the settings keys, not
    // replaced by them. Branding has answered to the clinic permissions since it
    // was built, and Stage 10 makes `settings:view` / `settings:manage` real
    // WITHOUT taking the screen away from a custom role that holds only the
    // clinic ones. Every earlier stage went out of its way to avoid removing
    // access on the day a permission started being enforced; this is the same
    // rule, and it is why these are lists rather than single strings.
    //
    // The write underneath still checks `clinic:edit` in PATCH /api/clinics/[id]
    // — so this widens who reaches the screen, never who may save from it.
    viewPermissions: ["settings:view", "settings:manage", "clinic:read", "clinic:edit"],
    managePermissions: ["settings:manage", "clinic:edit"],
  },
  {
    href: "/settings/whatsapp",
    title: "WhatsApp provider",
    description:
      "Connect tenant-owned RkvRobo accounts, register devices, and choose organisation or clinic sending numbers.",
    viewPermissions: ["settings:view", "settings:manage"],
    managePermissions: ["settings:manage"],
    feature: "whatsapp",
  },
  {
    href: "/settings/phone-settings",
    title: "Phone settings",
    description:
      "Configure reception, urgent-call routing, timezone, and the business hours used by automatic call handling.",
    viewPermissions: ["clinic:edit"],
    managePermissions: ["clinic:edit"],
    feature: "ivr",
  },
  {
    href: "/settings/phone-menu",
    title: "Phone menu",
    description:
      "Customize the automated greeting and keypad options callers hear when this clinic routes calls to IVR.",
    // The existing profile GET is a telephony-management read: it requires
    // clinic:read AND clinic:edit. Listing clinic:read or either settings key
    // here would advertise a page whose backend correctly refuses that actor.
    // clinic:edit is the discoverability signal; the page and API still re-run
    // the full tenant, scope, read, edit, and Clinics-module boundary.
    viewPermissions: ["clinic:edit"],
    managePermissions: ["clinic:edit"],
    feature: "ivr",
  },
] as const;

/**
 * Every permission that opens ANY settings section — what the sidebar's single
 * Settings tab is gated on.
 *
 * Derived rather than hand-listed, so a section added above appears in the
 * navigation automatically and cannot be left with a tab nobody can reach.
 */
export const SETTINGS_VIEW_PERMISSIONS: readonly string[] = [
  ...new Set(SETTINGS_SECTIONS.flatMap((section) => section.viewPermissions)),
];

/** Sections this person may open at all. */
export function visibleSettingsSections(
  holds: (permission: string) => boolean,
  featureAllowed?: (feature: string) => boolean,
): SettingsSection[] {
  return SETTINGS_SECTIONS.filter((section) => {
    if (!section.viewPermissions.some(holds)) return false;
    if (section.feature && featureAllowed && !featureAllowed(section.feature)) {
      return false;
    }
    return true;
  });
}

/** Whether this person may change anything on a section they can see. */
export function canManageSection(
  section: SettingsSection,
  holds: (permission: string) => boolean,
): boolean {
  return section.managePermissions.some(holds);
}
