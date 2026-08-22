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
}

export const NAV_LINKS: readonly NavLink[] = [
  // The landing page after sign-in. Always reachable, so a user whose roles
  // grant nothing still lands somewhere rather than on an empty sidebar.
  { href: "/dashboard", label: "Dashboard", permission: null },
  { href: "/registration", label: "Registrations", permission: "registration:read" },
  { href: "/doctors", label: "Doctors", permission: "doctor:read" },
  { href: "/clinics", label: "Clinics", permission: "clinic:read" },
  { href: "/reports", label: "Reports", permission: "report:read" },
  { href: "/notifications", label: "Notifications", permission: "notification:read" },
  { href: "/messages", label: "Messages", permission: "message:send" },
  { href: "/team", label: "Team", permission: "team:view" },
  { href: "/settings/roles", label: "Roles", permission: "role:read" },
] as const;

/**
 * Takes a predicate rather than a permission set so this module stays free of
 * anything server-only — see the note above about both sides importing it.
 */
export function visibleNavLinks(
  holds: (permission: string) => boolean,
): NavLink[] {
  return NAV_LINKS.filter(
    (link) => link.permission === null || holds(link.permission),
  );
}
