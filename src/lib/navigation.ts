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
 * not always the one that gates every control on it. Branding, for example,
 * needs `clinic:edit` rather than `clinic:read`: a user who can only look at a
 * clinic has nothing to do on that screen.
 */

export interface NavLink {
  href: string;
  label: string;
  /** null = always shown. Otherwise the permission needed, held in any scope. */
  permission: string | null;
  /**
   * The feature key that gates the module — Stage 8. null = never gated.
   *
   * Both filters are ANDed: a tab appears only when the person holds the
   * permission AND their organisation and role have the module. The pages
   * behind them re-check both, as ever.
   *
   * The settings tabs are deliberately null. If a feature switch could hide the
   * Roles or Features screens, an organisation could switch away the only
   * controls that would put it back — see UNGATED_MODULES in lib/features.ts.
   */
  feature: string | null;
}

export const NAV_LINKS: readonly NavLink[] = [
  // The landing page after sign-in. Always reachable, so a user whose roles
  // grant nothing still lands somewhere rather than on an empty sidebar.
  { href: "/dashboard", label: "Dashboard", permission: null, feature: null },
  { href: "/registration", label: "Registrations", permission: "registration:read", feature: "registrations" },
  { href: "/doctors", label: "Doctors", permission: "doctor:read", feature: "doctors" },
  { href: "/clinics", label: "Clinics", permission: "clinic:read", feature: "clinics" },
  { href: "/reports", label: "Reports", permission: "report:read", feature: "reports" },
  { href: "/notifications", label: "Notifications", permission: "notification:read", feature: "notifications" },
  { href: "/messages", label: "Messages", permission: "message:send", feature: "whatsapp" },
  { href: "/team", label: "Team", permission: "team:view", feature: "team" },
  { href: "/settings/roles", label: "Roles", permission: "role:read", feature: null },
  { href: "/settings/features", label: "Features", permission: "feature:view", feature: null },
] as const;

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
    (link) =>
      (link.permission === null || holds(link.permission)) &&
      (link.feature === null || hasFeature(link.feature)),
  );
}
