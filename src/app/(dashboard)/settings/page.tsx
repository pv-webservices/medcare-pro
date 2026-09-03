import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowRight,
  Building2,
  Clock3,
  History,
  LayoutDashboard,
  Lock,
  PhoneCall,
  ShieldCheck,
  Star,
  type LucideIcon,
} from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import { cx } from "@/components/ui/cx";
import { resolveModulesForActor } from "@/lib/features";
import type { ModuleFeatureKey } from "@/lib/moduleFeatures";
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

interface SectionStyle {
  icon: LucideIcon;
  iconBg: string;
  iconColor: string;
  displayDescription?: string;
}

const SECTION_STYLES: Record<string, SectionStyle> = {
  "/settings/dashboard": {
    icon: LayoutDashboard,
    iconBg: "bg-[#ece9fe] dark:bg-accent-soft",
    iconColor: "text-[#5b4bff] dark:text-accent-bright",
    displayDescription: "Arrange your dashboard and set defaults for different user roles.",
  },
  "/settings/roles": {
    icon: ShieldCheck,
    iconBg: "bg-[#e0f2fe] dark:bg-info-bg",
    iconColor: "text-[#0284c7] dark:text-info-mark",
    displayDescription: "Create roles, define what each one can do, and assign them to users.",
  },
  "/settings/features": {
    icon: Star,
    iconBg: "bg-[#e8f8f0] dark:bg-ok-bg",
    iconColor: "text-[#16a34a] dark:text-ok-mark",
    displayDescription: "Choose which features may be used and what access each role has.",
  },
  "/settings/audit": {
    icon: History,
    iconBg: "bg-[#fef3c7] dark:bg-warn-bg",
    iconColor: "text-[#d97706] dark:text-warn-mark",
    displayDescription: "See who did what, when — team changes, role updates, and account activity.",
  },
  "/settings/branding": {
    icon: Building2,
    iconBg: "bg-[#fce7f3] dark:bg-alert-bg",
    iconColor: "text-[#db2777] dark:text-alert-mark",
    displayDescription: "Update your clinic's name, address, location, and logo.",
  },
  "/settings/phone-menu": {
    icon: PhoneCall,
    iconBg: "bg-[#e0f7f4] dark:bg-ok-bg",
    iconColor: "text-[#0f8f83] dark:text-ok-mark",
    displayDescription:
      "Customize the automated greeting and keypad options callers hear.",
  },
  "/settings/phone-settings": {
    icon: Clock3,
    iconBg: "bg-[#fff1df] dark:bg-warn-bg",
    iconColor: "text-[#c66a13] dark:text-warn-mark",
    displayDescription:
      "Configure call destinations, timezone, and automatic business hours.",
  },
};

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

  const [held, modules] = await Promise.all([
    permissionsHeldAnywhere(actor),
    resolveModulesForActor(actor),
  ]);
  const isFeatureAllowed = (feature: string) =>
    modules.get(feature as ModuleFeatureKey)?.allowed === true;
  const holds = (permission: string) => holdsAnywhere(held, permission);

  const visible = visibleSettingsSections(holds, isFeatureAllowed);

  if (visible.length === 0) {
    return (
      <section className="space-y-4">
        <PageHeader
          title="Settings"
          description="Manage and configure your account settings, permissions, and clinic preferences."
        />
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
  const hidden = SETTINGS_SECTIONS.filter(
    (section) =>
      !visible.includes(section) &&
      (!section.feature || isFeatureAllowed(section.feature)),
  );

  return (
    <section className="space-y-6">
      <PageHeader
        title="Settings"
        description="Manage and configure your account settings, permissions, and clinic preferences."
      />

      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map((section) => {
          const canManage = canManageSection(section, holds);
          const style = SECTION_STYLES[section.href] ?? {
            icon: LayoutDashboard,
            iconBg: "bg-canvas-deep",
            iconColor: "text-muted",
          };
          const Icon = style.icon;
          const isDashboard = section.href === "/settings/dashboard";

          return (
            <Link
              key={section.href}
              href={section.href}
              className={cx(
                "group relative flex flex-col justify-between rounded-3xl border border-line bg-canvas p-6 shadow-card transition-all duration-200 hover:-translate-y-0.5 hover:border-line-strong hover:shadow-raised sm:p-7",
                "min-h-[190px]",
              )}
            >
              {/* Active left indicator rail for Dashboard (matching screenshot) */}
              {isDashboard && (
                <span
                  aria-hidden="true"
                  className="absolute inset-y-6 left-0 w-1 rounded-r-full bg-accent"
                />
              )}

              <div>
                <div className="flex items-start gap-4">
                  <div
                    className={cx(
                      "flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl transition-transform duration-200 group-hover:scale-105",
                      style.iconBg,
                      style.iconColor,
                    )}
                  >
                    <Icon aria-hidden="true" strokeWidth={1.8} className="h-6 w-6" />
                  </div>

                  <div className="min-w-0 flex-1 pt-0.5">
                    <h2 className="text-section font-semibold text-ink transition-colors duration-150 group-hover:text-accent">
                      {section.title}
                    </h2>
                    <p className="mt-2 text-label leading-relaxed text-muted">
                      {style.displayDescription ?? section.description}
                    </p>
                  </div>
                </div>
              </div>

              <div className="mt-6 flex items-center justify-between gap-3 pt-2">
                <span
                  className={cx(
                    "rounded-md px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide",
                    canManage
                      ? "bg-[#eeecff] text-[#5b4bff] dark:bg-accent-soft dark:text-accent-soft-ink"
                      : "bg-[#fef3c7] text-[#92400e] dark:bg-warn-bg dark:text-warn-ink",
                  )}
                >
                  {canManage ? "YOU CAN CHANGE THIS" : "VIEW ONLY"}
                </span>

                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-line bg-canvas text-muted shadow-sm transition-colors duration-150 group-hover:border-line-strong group-hover:bg-canvas-deep group-hover:text-ink">
                  <ArrowRight
                    aria-hidden="true"
                    strokeWidth={2}
                    className="h-4 w-4 transition-transform duration-150 group-hover:translate-x-0.5"
                  />
                </span>
              </div>
            </Link>
          );
        })}
      </div>

      {hidden.length > 0 && (
        <div className="rounded-3xl border border-line bg-canvas-deep p-6">
          <h2 className="flex items-center gap-2 text-label font-semibold text-muted">
            <Lock aria-hidden="true" strokeWidth={1.75} className="h-4 w-4" />
            Not available to your role
          </h2>
          <ul className="mt-3 space-y-1.5">
            {hidden.map((section) => (
              <li key={section.href} className="text-label text-muted">
                <span className="font-medium text-ink">{section.title}</span>{" "}
                — {section.description}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
