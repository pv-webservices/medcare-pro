import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, Lock } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import { holdsAnywhere, permissionsHeldAnywhere } from "@/lib/rbac";
import { requireActor, UnauthenticatedError } from "@/lib/session";
import {
  SETTINGS_SECTIONS,
  canManageSection,
  visibleSettingsSections,
} from "@/lib/settingsSections";

// Settings — PRD §6.8, the section itself (Stage 10).
//
// A landing page rather than a redirect to the first screen. Which screens a
// person can open depends on their role, so a redirect would send two people
// with different roles to different places under one label, and neither would
// learn that the other screens existed.
//
// EVERY CARD HERE IS A COURTESY, NOT A GATE. Each screen behind these links runs
// its own check and refuses a caller who types the URL — the same rule the
// sidebar keeps. What this page adds is the honest answer to "what is in here
// and may I change it", which is otherwise only discoverable by clicking
// through and being refused.
//
// Permissions are resolved ANYWHERE rather than for the selected clinic: these
// are account-level screens, and a person who administers one clinic should
// still find the section rather than be told it does not exist.

export default async function SettingsPage() {
  let actor;
  try {
    actor = await requireActor();
  } catch (error: unknown) {
    if (error instanceof UnauthenticatedError) {
      redirect("/login");
    }
    throw error;
  }

  const held = await permissionsHeldAnywhere(actor);
  const holds = (permission: string) => holdsAnywhere(held, permission);

  const visible = visibleSettingsSections(holds);

  if (visible.length === 0) {
    return (
      <section className="space-y-4">
        <PageHeader title="Settings" />
        <div className="rounded-2xl border border-line bg-canvas-deep px-5 py-4 text-body text-muted">
          Your role does not open any of the settings screens. Ask the account
          owner if you need access.
        </div>
      </section>
    );
  }

  // Sections they cannot open are still named, without a link. Silence would
  // leave someone unable to tell "this organisation has no such screen" from
  // "my role does not reach it" — and only one of those is worth asking about.
  const hidden = SETTINGS_SECTIONS.filter((section) => !visible.includes(section));

  return (
    <section className="space-y-5">
      <PageHeader
        title="Settings"
        description="Roles, features, clinic details and activity for this account."

      />

      <div className="grid gap-4 sm:grid-cols-2">
        {visible.map((section) => {
          const canManage = canManageSection(section, holds);

          return (
            <Link
              key={section.href}
              href={section.href}
              className="lift group rounded-3xl border border-line bg-canvas p-5 shadow-card hover:border-line-strong"
            >
              <div className="flex items-start justify-between gap-3">
                <h2 className="text-section font-semibold text-ink">
                  {section.title}
                </h2>
                <ArrowRight
                  aria-hidden="true"
                  strokeWidth={1.75}
                  className="mt-0.5 h-4 w-4 shrink-0 text-faint transition-colors duration-150 group-hover:text-accent"
                />
              </div>
              <p className="mt-2 text-label text-muted">{section.description}</p>
              <p className="mt-3 text-micro font-semibold uppercase text-faint">
                {canManage ? "You can change this" : "View only"}
              </p>
            </Link>
          );
        })}
      </div>

      {hidden.length > 0 && (
        <div className="rounded-3xl border border-line bg-canvas-deep p-5">
          <h2 className="flex items-center gap-2 text-label font-semibold text-muted">
            <Lock aria-hidden="true" strokeWidth={1.75} className="h-4 w-4" />
            Not available to your role
          </h2>
          <ul className="mt-2 space-y-1">
            {hidden.map((section) => (
              <li key={section.href} className="text-label text-muted">
                <span className="font-medium text-muted">{section.title}</span>{""}
                — {section.description}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
