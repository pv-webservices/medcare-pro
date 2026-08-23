/**
 * The dashboard's navigation, and which permission each tab needs.
 *
 * Pure data and one filter: no Prisma, no session, so both the server layout
 * and the client nav component can import it. The layout resolves what the user
 * holds and passes the surviving links down.
 *
 * Labels use the PRD's vocabulary exactly ("Registrations", "Doctors",
 * "Clinics"), so staff never have to translate the interface's words into the
 * clinic's own.
 *
 * **Hiding a tab is not access control.** Every page behind these links runs
 * its own server-side check and refuses a caller who reaches it by typing the
 * URL. This list exists so nobody is offered a door that will only refuse them
 * — it is the courtesy layer on top of the enforcement, never a substitute.
 *
 * The permission named here is the one that makes the page *useful*, which is
 * not always the one that gates every control on it. The Settings tab names
 * several, because the screens behind it answer to different ones.
 */

import { SETTINGS_VIEW_PERMISSIONS } from "@/lib/settingsSections";

export interface NavLink {
  href: string;
  label: string;
  /**
   * null = always shown. A string = the permission needed, held in any scope.
   * A LIST = any one of them is enough.
   *
   * The list form exists for the Settings tab, which fronts several screens
   * answering to different permissions — see src/lib/settingsSections.ts. A
   * single string there would have meant either hiding the tab from someone who
   * can reach one of its screens, or showing it to someone who can reach none.
   */
  permission: string | readonly string[] | null;
  /**
   * The feature key that gates the module — Stage 8. null = never gated.
   *
   * Both filters are ANDed: a tab appears only when the person holds the
   * permission AND their organisation and role have the module. The pages
   * behind them re-check both, as ever.
   *
   * The Settings tab is deliberately null. If a feature switch could hide the
   * Roles or Features screens, an organisation could switch away the only
   * controls that would put it back — see UNGATED_MODULES in lib/features.ts.
   */
  feature: string | null;
}

export const NAV_LINKS: readonly NavLink[] = [
  // The landing page after sign-in. Always reachable, so a user whose roles
  // grant nothing still lands somewhere rather than on an empty sidebar.
  { href: "/dashboard", label: "Dashboard", permission: null, feature: null },
  // AP-6. Ahead of Registrations because that is the order the day runs in: a
  // slot is booked, the patient arrives, and the arrival becomes a
  // registration. An Appointment and a Registration are different records —
  // see the vocabulary rule in .claude/skills/admin-dashboard-ui.
  { href: "/appointments", label: "Appointments", permission: "appointment:read", feature: "appointments" },
  { href: "/registration", label: "Registrations", permission: "registration:read", feature: "registrations" },
  { href: "/doctors", label: "Doctors", permission: "doctor:read", feature: "doctors" },
  { href: "/clinics", label: "Clinics", permission: "clinic:read", feature: "clinics" },
  { href: "/reports", label: "Reports", permission: "report:read", feature: "reports" },
  { href: "/notifications", label: "Notifications", permission: "notification:read", feature: "notifications" },
  { href: "/messages", label: "Messages", permission: "message:send", feature: "whatsapp" },
  { href: "/team", label: "Team", permission: "team:view", feature: "team" },
  // Stage 10. One tab for the whole section rather than one per screen: three
  // of ten sidebar entries belonging to settings crowded out the modules staff
  // use all day, and Branding had no entry at all — it was reachable only by
  // typing its URL, which made FR-8.3 and FR-8.4 built but undiscoverable.
  {
    href: "/settings",
    label: "Settings",
    permission: SETTINGS_VIEW_PERMISSIONS,
    feature: null,
  },
] as const;

/** null passes, a string must be held, a list needs any one of them. */
function holdsNavPermission(
  permission: NavLink["permission"],
  holds: (permission: string) => boolean,
): boolean {
  if (permission === null) {
    return true;
  }
  return typeof permission === "string"
    ? holds(permission)
    : permission.some(holds);
}

/**
 * Takes predicates rather than resolved sets so this module stays free of
 * anything server-only — see the note above about both sides importing it.
 *
 * `hasFeature` defaults to allowing everything, which keeps the older one-
 * argument callers (and the pure tests) working while making the feature filter
 * opt-in at the one call site that can afford to resolve it.
 */
export function visibleNavLinks(
  holds: (permission: string) => boolean,
  hasFeature: (feature: string) => boolean = () => true,
): NavLink[] {
  return NAV_LINKS.filter(
    (link) => holdsNavPermission(link.permission, holds) &&
      (link.feature === null || hasFeature(link.feature)),
  );
}
