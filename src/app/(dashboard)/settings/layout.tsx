import type { ReactNode } from "react";
import SettingsNav from "@/components/settings/SettingsNav";
import { resolveModulesForActor } from "@/lib/features";
import type { ModuleFeatureKey } from "@/lib/moduleFeatures";
import { holdsAnywhere, permissionsHeldAnywhere } from "@/lib/rbac";
import { requireActor, UnauthenticatedError } from "@/lib/session";
import { visibleSettingsSections } from "@/lib/settingsSections";

/**
 * The Settings section shell — one tab row above every settings screen.
 *
 * WHY A LAYOUT AND NOT A COMPONENT PER PAGE. Four screens each resolving the
 * same permission set to draw the same row is four queries and four chances to
 * drift. The layout resolves it once and the tabs are identical everywhere, so
 * moving between Roles, Features, Clinic details and the Activity log is one
 * click rather than a trip back to the Settings landing page.
 *
 * IT DECIDES NOTHING. The tabs are filtered by `visibleSettingsSections`, the
 * same predicate the landing page and the sidebar use, and every screen behind
 * them re-checks its own permission server-side. A tab is a courtesy; the page
 * is the gate.
 *
 * A layout cannot redirect a refused session the way the dashboard shell does —
 * it renders above pages that handle their own refusals — so an unauthenticated
 * render simply draws no tabs and lets the page below say why.
 */

export default async function SettingsLayout({
  children,
}: {
  children: ReactNode;
}) {
  let items: { href: string; label: string }[] = [];

  try {
    const actor = await requireActor();
    const [held, modules] = await Promise.all([
      permissionsHeldAnywhere(actor),
      resolveModulesForActor(actor),
    ]);
    items = visibleSettingsSections(
      (permission) => holdsAnywhere(held, permission),
      (feature) => modules.get(feature as ModuleFeatureKey)?.allowed === true,
    ).map((section) => ({ href: section.href, label: section.title }));
  } catch (error: unknown) {
    if (!(error instanceof UnauthenticatedError)) {
      throw error;
    }
  }

  return (
    <>
      <SettingsNav items={items} />
      {children}
    </>
  );
}
