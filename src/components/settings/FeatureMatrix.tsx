"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Bell,
  Building2,
  Calendar,
  Check,
  ChevronDown,
  Info,
  Layers,
  ListTodo,
  Lock,
  Megaphone,
  MessageSquare,
  Search,
  Settings,
  SlidersHorizontal,
  Stethoscope,
  TrendingUp,
  User,
  UsersRound,
} from "lucide-react";
import Menu from "@/components/ui/Menu";
import { useToast } from "@/components/ui/Toast";
import { cx } from "@/components/ui/cx";
import type { FeatureOverviewRow, RoleFeatureRow } from "@/lib/features";

/**
 * Which roles may use which of the organisation's features — Stage 8, layer 3.
 *
 * Compact role-vs-feature management matrix matching MEDCARE PRO design specs.
 *
 * ONE SWITCH PER (ROLE x FEATURE), and a tri-state underneath it:
 *   - "inherit" (null in DB: follows plan/organisation default)
 *   - "on" (true: explicit grant for this role)
 *   - "off" (false: explicit denial for this role)
 */

interface FeatureMatrixProps {
  features: readonly FeatureOverviewRow[];
  canManage: boolean;
}

/** The stored tri-state, as a control value. */
type AccessValue = "inherit" | "on" | "off";

function fromValue(value: AccessValue): boolean | null {
  return value === "inherit" ? null : value === "on";
}

/** Map feature keys to Lucide icons */
const FEATURE_ICONS: Record<string, typeof Calendar> = {
  appointments: Calendar,
  clinics: Building2,
  doctors: Stethoscope,
  marketing: Megaphone,
  notifications: Bell,
  registrations: User,
  reports: TrendingUp,
  settings: Settings,
  tasks: ListTodo,
  team: UsersRound,
  whatsapp: MessageSquare,
};

/** Plan / tier badge text and style mapping */
function getTierBadge(feature: FeatureOverviewRow) {
  if (feature.key === "whatsapp" || feature.tier === "BETA") {
    return {
      label: "ADD-ON",
      className:
        "border-amber-200/80 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300",
    };
  }
  if (feature.tier === "PREMIUM") {
    return {
      label: "PREMIUM",
      className:
        "border-indigo-200/80 bg-indigo-50 text-indigo-700 dark:border-indigo-900/60 dark:bg-indigo-950/40 dark:text-indigo-300",
    };
  }
  return {
    label: "CORE",
    className:
      "border-line/70 bg-slate-100 text-slate-600 dark:border-line dark:bg-canvas-deep dark:text-slate-300",
  };
}

/** One line saying where the organisation's entitlement comes from. */
function featureNote(feature: FeatureOverviewRow): string {
  switch (feature.entitlementSource) {
    case "plan":
      return "Included in your plan.";
    case "override-granted":
      return "Added to your organisation specifically.";
    case "override-revoked":
      return "Switched off for your organisation.";
    case "plan-excludes":
    case "not-in-plan":
      return "Not part of your plan.";
    case "global-off":
      return "Temporarily unavailable across MEDCARE PRO.";
    default:
      return "Included in your plan.";
  }
}

export default function FeatureMatrix({ features, canManage }: FeatureMatrixProps) {
  const router = useRouter();
  const showToast = useToast();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());

  // Distinct roles across features, preserving order
  const roles = useMemo(() => {
    if (features.length === 0) return [];
    return features[0].roles;
  }, [features]);

  // Overall metric counts
  const totalCount = features.length;
  const includedCount = useMemo(
    () => features.filter((f) => f.isEntitled).length,
    [features],
  );
  const notIncludedCount = totalCount - includedCount;

  // Filtered features by search query
  const filteredFeatures = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return features;
    return features.filter(
      (f) =>
        f.name.toLowerCase().includes(q) ||
        f.key.toLowerCase().includes(q) ||
        (f.description && f.description.toLowerCase().includes(q)),
    );
  }, [features, searchQuery]);

  function toggleExpand(key: string) {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  function handleCollapseAllToggle() {
    if (expandedKeys.size > 0) {
      setExpandedKeys(new Set());
    } else {
      setExpandedKeys(new Set(features.map((f) => f.key)));
    }
  }

  async function handleChange(
    feature: FeatureOverviewRow,
    role: RoleFeatureRow,
    value: AccessValue,
  ) {
    const key = `${feature.key}:${role.roleId}`;
    setBusyKey(key);

    try {
      const response = await fetch("/api/features", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roleId: role.roleId,
          featureKey: feature.key,
          enabled: fromValue(value),
        }),
      });

      const body: { success?: boolean; error?: string } = await response
        .json()
        .catch(() => ({}));

      if (!response.ok || !body.success) {
        showToast({
          tone: "alert",
          title: body.error ?? "Could not change that. Try again.",
        });
        return;
      }

      showToast({
        tone: "ok",
        title:
          value === "inherit"
            ? `${role.roleName} now follows the organisation for ${feature.name}.`
            : `${feature.name} is ${value === "on" ? "on" : "off"} for ${role.roleName}.`,
      });
      router.refresh();
    } catch {
      showToast({
        tone: "alert",
        title: "Could not reach the server. Check your connection.",
      });
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <div className="space-y-4">
      {/* 1. Compact Summary Toolbar */}
      <div className="flex flex-col gap-3 rounded-2xl border border-line bg-canvas p-3 sm:flex-row sm:items-center sm:justify-between sm:px-4 shadow-sm">
        {/* Metric counts */}
        <div className="flex flex-wrap items-center gap-2.5 text-xs text-muted">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent-soft text-accent">
            <SlidersHorizontal className="h-3.5 w-3.5" />
          </div>

          <div className="flex items-center gap-1.5">
            <span className="font-bold text-ink">{totalCount}</span>
            <span>Total features</span>
          </div>

          <span className="text-line" aria-hidden="true">
            ·
          </span>

          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            <span className="font-bold text-ink">{includedCount}</span>
            <span>Included</span>
          </div>

          <span className="text-line" aria-hidden="true">
            ·
          </span>

          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-rose-500" />
            <span className="font-bold text-ink">{notIncludedCount}</span>
            <span>Not included</span>
          </div>
        </div>

        {/* Search & Collapse actions */}
        <div className="flex items-center gap-2 sm:shrink-0">
          <div className="relative flex-1 sm:w-56">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search features..."
              className="h-8 w-full rounded-xl border border-line bg-canvas pl-8 pr-3 text-xs text-ink placeholder:text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>

          <button
            type="button"
            onClick={handleCollapseAllToggle}
            className="inline-flex h-8 items-center justify-center rounded-xl border border-line bg-canvas px-3 text-xs font-medium text-ink transition-colors hover:bg-canvas-deep shrink-0"
          >
            {expandedKeys.size > 0 ? "Collapse all" : "Expand all"}
          </button>
        </div>
      </div>

      {/* 2. Feature Matrix Surface */}
      <div className="overflow-hidden rounded-2xl border border-line bg-canvas shadow-card">
        {filteredFeatures.length === 0 ? (
          <div className="px-6 py-12 text-center text-xs text-muted">
            No features found matching &ldquo;{searchQuery}&rdquo;.
          </div>
        ) : (
          <>
            {/* Desktop Matrix (lg and above) */}
            <div className="hidden lg:block overflow-x-auto">
              <div className="min-w-[960px]">
                {/* Column Headers */}
                <div className="grid grid-cols-[minmax(280px,3fr)_repeat(6,minmax(95px,1fr))_36px] items-center border-b border-line bg-canvas px-5 py-3 text-xs font-semibold text-ink">
                  <div>FEATURE</div>
                  {roles.map((role) => (
                    <div key={role.roleId} className="text-center">
                      <div className="leading-tight">{role.roleName}</div>
                      {role.isAccountOwner && (
                        <span className="block text-[9px] font-normal text-muted leading-tight mt-0.5">
                          Account owner — always on
                        </span>
                      )}
                    </div>
                  ))}
                  <div aria-hidden="true" />
                </div>

                {/* Rows */}
                <div className="divide-y divide-line/60">
                  {filteredFeatures.map((feature) => {
                    const isExpanded = expandedKeys.has(feature.key);
                    const Icon = FEATURE_ICONS[feature.key] ?? Layers;
                    const tierBadge = getTierBadge(feature);

                    return (
                      <div
                        key={feature.key}
                        className="transition-colors hover:bg-canvas-deep/20"
                      >
                        <div className="grid grid-cols-[minmax(280px,3fr)_repeat(6,minmax(95px,1fr))_36px] items-center px-5 py-3.5 gap-2">
                          {/* Feature metadata */}
                          <div className="flex items-start gap-3 min-w-0 pr-2">
                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent mt-0.5">
                              <Icon className="h-4.5 w-4.5" strokeWidth={2} />
                            </div>

                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="text-xs font-bold text-ink truncate">
                                  {feature.name}
                                </span>

                                <span
                                  className={cx(
                                    "inline-flex items-center rounded-full border px-1.5 py-0.2 text-[9px] font-bold uppercase tracking-wider",
                                    tierBadge.className,
                                  )}
                                >
                                  {tierBadge.label}
                                </span>

                                {feature.isEntitled ? (
                                  <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200/80 bg-emerald-50 px-1.5 py-0.2 text-[9px] font-bold uppercase tracking-wider text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300">
                                    <Check className="h-2.5 w-2.5 stroke-[2.5]" />
                                    INCLUDED
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 rounded-full border border-rose-200/80 bg-rose-50 px-1.5 py-0.2 text-[9px] font-bold uppercase tracking-wider text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300">
                                    <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
                                    NOT INCLUDED
                                  </span>
                                )}
                              </div>

                              {feature.description && (
                                <p className="mt-1 text-[11px] leading-snug text-muted line-clamp-2">
                                  {feature.description}
                                </p>
                              )}

                              <p className="mt-0.5 text-[11px] text-muted">
                                {featureNote(feature)}
                              </p>
                            </div>
                          </div>

                          {/* Role access or special states */}
                          {feature.isEntitled && !feature.isUngated ? (
                            roles.map((role) => {
                              const key = `${feature.key}:${role.roleId}`;
                              const isOwner = role.isAccountOwner;
                              const isEditable = role.isEditable && canManage;

                              return (
                                <div
                                  key={role.roleId}
                                  className="flex items-center justify-center px-1"
                                >
                                  {isOwner ? (
                                    <div className="inline-flex h-7 items-center justify-center gap-1.5 rounded-lg border border-line bg-canvas-deep px-2.5 text-[11px] font-medium text-muted">
                                      <Lock className="h-3 w-3 text-muted" aria-hidden="true" />
                                      <span>Always on</span>
                                    </div>
                                  ) : isEditable ? (
                                    <Menu
                                      usePortal
                                      align="end"
                                      label={`${feature.name} access for ${role.roleName}`}
                                      trigger={({ isOpen }) => (
                                        <div
                                          className={cx(
                                            "inline-flex h-7 w-[92px] items-center justify-between gap-1 rounded-lg border px-2 text-[11px] font-medium transition-colors",
                                            role.isEffective
                                              ? "border-emerald-200/80 bg-emerald-50 text-emerald-700 hover:bg-emerald-100/70"
                                              : "border-line bg-canvas-deep text-muted hover:bg-canvas-deep/80 hover:text-ink",
                                            busyKey === key && "opacity-60 cursor-wait",
                                            isOpen && "ring-1 ring-accent",
                                          )}
                                        >
                                          <span className="truncate">
                                            {role.isEffective ? "Can use" : "Cannot use"}
                                          </span>
                                          <ChevronDown
                                            className={cx(
                                              "h-3 w-3 shrink-0 transition-transform text-current",
                                              isOpen && "rotate-180",
                                            )}
                                          />
                                        </div>
                                      )}
                                    >
                                      <div className="p-1 space-y-0.5 min-w-[210px]">
                                        <div className="px-2 py-1 text-[11px] font-semibold text-muted">
                                          {feature.name} · {role.roleName}
                                        </div>
                                        <button
                                          type="button"
                                          disabled={busyKey === key}
                                          onClick={() => handleChange(feature, role, "inherit")}
                                          className={cx(
                                            "w-full flex items-center justify-between px-2 py-1.5 text-xs rounded-lg text-left transition-colors",
                                            role.access === null
                                              ? "bg-accent-soft text-accent font-semibold"
                                              : "text-ink hover:bg-canvas-deep",
                                          )}
                                        >
                                          <span>
                                            Follow organisation (
                                            {feature.inheritsWhenSilent ? "on" : "off"})
                                          </span>
                                          {role.access === null && (
                                            <Check className="h-3.5 w-3.5 text-accent" />
                                          )}
                                        </button>
                                        <button
                                          type="button"
                                          disabled={busyKey === key}
                                          onClick={() => handleChange(feature, role, "on")}
                                          className={cx(
                                            "w-full flex items-center justify-between px-2 py-1.5 text-xs rounded-lg text-left transition-colors",
                                            role.access === true
                                              ? "bg-accent-soft text-accent font-semibold"
                                              : "text-ink hover:bg-canvas-deep",
                                          )}
                                        >
                                          <span>On for this role</span>
                                          {role.access === true && (
                                            <Check className="h-3.5 w-3.5 text-accent" />
                                          )}
                                        </button>
                                        <button
                                          type="button"
                                          disabled={busyKey === key}
                                          onClick={() => handleChange(feature, role, "off")}
                                          className={cx(
                                            "w-full flex items-center justify-between px-2 py-1.5 text-xs rounded-lg text-left transition-colors",
                                            role.access === false
                                              ? "bg-accent-soft text-accent font-semibold"
                                              : "text-ink hover:bg-canvas-deep",
                                          )}
                                        >
                                          <span>Off for this role</span>
                                          {role.access === false && (
                                            <Check className="h-3.5 w-3.5 text-accent" />
                                          )}
                                        </button>
                                      </div>
                                    </Menu>
                                  ) : (
                                    <div
                                      className={cx(
                                        "inline-flex h-7 w-[92px] items-center justify-center rounded-lg border px-2 text-[11px] font-medium",
                                        role.isEffective
                                          ? "border-emerald-200/80 bg-emerald-50 text-emerald-700"
                                          : "border-line bg-canvas-deep text-muted",
                                      )}
                                    >
                                      <span>{role.isEffective ? "Can use" : "Cannot use"}</span>
                                    </div>
                                  )}
                                </div>
                              );
                            })
                          ) : (
                            <div className="col-span-6 flex items-center px-3">
                              <div className="flex w-full items-center gap-2 rounded-xl border border-line/60 bg-canvas-deep/70 px-3 py-1.5 text-[11px] text-muted">
                                <Info className="h-3.5 w-3.5 shrink-0 text-muted" />
                                <span>
                                  {feature.isUngated
                                    ? "Always available. This is the screen that unlocks all features."
                                    : "Not available within organization."}
                                </span>
                              </div>
                            </div>
                          )}

                          {/* Expand/Collapse Toggle */}
                          <div className="flex items-center justify-center">
                            <button
                              type="button"
                              onClick={() => toggleExpand(feature.key)}
                              aria-expanded={isExpanded}
                              aria-label={`${isExpanded ? "Collapse" : "Expand"} details for ${feature.name}`}
                              className="flex h-7 w-7 items-center justify-center rounded-lg text-muted hover:bg-canvas-deep hover:text-ink transition-colors"
                            >
                              <ChevronDown
                                className={cx(
                                  "h-4 w-4 transition-transform duration-150",
                                  isExpanded && "rotate-180",
                                )}
                              />
                            </button>
                          </div>
                        </div>

                        {/* Expanded detail drawer */}
                        {isExpanded && (
                          <div className="border-t border-line/60 bg-canvas-deep/40 px-6 py-3.5 text-xs text-muted">
                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                              <div>
                                <span className="font-semibold text-ink">Module Key:</span>{" "}
                                <code className="rounded bg-canvas px-1.5 py-0.5 text-[11px] font-mono text-ink">
                                  {feature.key}
                                </code>
                              </div>
                              <div>
                                <span className="font-semibold text-ink">Tier:</span>{" "}
                                <span>{feature.tier}</span>
                              </div>
                              <div>
                                <span className="font-semibold text-ink">Entitlement Source:</span>{" "}
                                <span>{feature.entitlementSource}</span>
                              </div>
                            </div>

                            <div className="mt-2.5 text-[11px] text-muted leading-relaxed">
                              {feature.isUngated ? (
                                <p>{feature.ungatedNote}</p>
                              ) : !feature.isEntitled ? (
                                <p>
                                  Your organisation does not have this feature entitled, so it cannot
                                  be granted to any role. Contact MEDCARE PRO support to activate this module.
                                </p>
                              ) : (
                                <p>
                                  Silent inheritance rule:{" "}
                                  {feature.inheritsWhenSilent
                                    ? "Roles with no explicit preference inherit (Enabled) by default."
                                    : "Roles with no explicit preference inherit (Disabled) by default until explicitly enabled."}
                                </p>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Mobile / Tablet Responsive Fallback (below lg) */}
            <div className="lg:hidden divide-y divide-line">
              {filteredFeatures.map((feature) => {
                const isExpanded = expandedKeys.has(feature.key);
                const Icon = FEATURE_ICONS[feature.key] ?? Layers;
                const tierBadge = getTierBadge(feature);

                return (
                  <div key={feature.key} className="p-4 space-y-3">
                    {/* Header */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-2.5">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent mt-0.5">
                          <Icon className="h-4 w-4" strokeWidth={2} />
                        </div>
                        <div>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-xs font-bold text-ink">{feature.name}</span>
                            <span
                              className={cx(
                                "inline-flex items-center rounded-full border px-1.5 py-0.2 text-[9px] font-bold uppercase",
                                tierBadge.className,
                              )}
                            >
                              {tierBadge.label}
                            </span>
                            {feature.isEntitled ? (
                              <span className="inline-flex items-center gap-0.5 rounded-full border border-emerald-200/80 bg-emerald-50 px-1.5 py-0.2 text-[9px] font-bold text-emerald-700">
                                <Check className="h-2.5 w-2.5 stroke-[2.5]" />
                                INCLUDED
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 rounded-full border border-rose-200/80 bg-rose-50 px-1.5 py-0.2 text-[9px] font-bold text-rose-700">
                                NOT INCLUDED
                              </span>
                            )}
                          </div>
                          {feature.description && (
                            <p className="mt-1 text-[11px] text-muted">{feature.description}</p>
                          )}
                          <p className="mt-0.5 text-[11px] text-muted">{featureNote(feature)}</p>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => toggleExpand(feature.key)}
                        aria-expanded={isExpanded}
                        className="flex h-7 w-7 items-center justify-center rounded-lg text-muted hover:bg-canvas-deep shrink-0"
                      >
                        <ChevronDown
                          className={cx("h-4 w-4 transition-transform", isExpanded && "rotate-180")}
                        />
                      </button>
                    </div>

                    {/* Roles or callout */}
                    {feature.isEntitled && !feature.isUngated ? (
                      <div className="space-y-1.5 rounded-xl border border-line/60 bg-canvas-deep/30 p-2.5">
                        <div className="text-[10px] font-bold uppercase tracking-wider text-muted mb-1 px-1">
                          Role Access
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {roles.map((role) => {
                            const key = `${feature.key}:${role.roleId}`;
                            const isOwner = role.isAccountOwner;
                            const isEditable = role.isEditable && canManage;

                            return (
                              <div
                                key={role.roleId}
                                className="flex items-center justify-between gap-2 rounded-lg bg-canvas p-2 border border-line/60"
                              >
                                <div className="min-w-0">
                                  <div className="text-xs font-semibold text-ink truncate">
                                    {role.roleName}
                                  </div>
                                  {isOwner && (
                                    <div className="text-[10px] text-muted">Account owner</div>
                                  )}
                                </div>

                                <div>
                                  {isOwner ? (
                                    <div className="inline-flex h-6 items-center gap-1 rounded-md border border-line bg-canvas-deep px-2 text-[10px] font-medium text-muted">
                                      <Lock className="h-2.5 w-2.5" />
                                      <span>Always on</span>
                                    </div>
                                  ) : isEditable ? (
                                    <Menu
                                      usePortal
                                      align="end"
                                      label={`${feature.name} for ${role.roleName}`}
                                      trigger={({ isOpen }) => (
                                        <div
                                          className={cx(
                                            "inline-flex h-6 w-24 items-center justify-between gap-1 rounded-md border px-2 text-[10px] font-medium",
                                            role.isEffective
                                              ? "border-emerald-200/80 bg-emerald-50 text-emerald-700"
                                              : "border-line bg-canvas-deep text-muted",
                                            isOpen && "ring-1 ring-accent",
                                          )}
                                        >
                                          <span>{role.isEffective ? "Can use" : "Cannot use"}</span>
                                          <ChevronDown className="h-2.5 w-2.5" />
                                        </div>
                                      )}
                                    >
                                      <div className="p-1 space-y-0.5 min-w-[200px]">
                                        <button
                                          type="button"
                                          disabled={busyKey === key}
                                          onClick={() => handleChange(feature, role, "inherit")}
                                          className="w-full text-left px-2 py-1 text-xs text-ink hover:bg-canvas-deep rounded disabled:opacity-50"
                                        >
                                          Follow organisation (
                                          {feature.inheritsWhenSilent ? "on" : "off"})
                                        </button>
                                        <button
                                          type="button"
                                          disabled={busyKey === key}
                                          onClick={() => handleChange(feature, role, "on")}
                                          className="w-full text-left px-2 py-1 text-xs text-ink hover:bg-canvas-deep rounded disabled:opacity-50"
                                        >
                                          On for this role
                                        </button>
                                        <button
                                          type="button"
                                          disabled={busyKey === key}
                                          onClick={() => handleChange(feature, role, "off")}
                                          className="w-full text-left px-2 py-1 text-xs text-ink hover:bg-canvas-deep rounded disabled:opacity-50"
                                        >
                                          Off for this role
                                        </button>
                                      </div>
                                    </Menu>
                                  ) : (
                                    <div
                                      className={cx(
                                        "inline-flex h-6 items-center rounded-md border px-2 text-[10px] font-medium",
                                        role.isEffective
                                          ? "border-emerald-200/80 bg-emerald-50 text-emerald-700"
                                          : "border-line bg-canvas-deep text-muted",
                                      )}
                                    >
                                      <span>{role.isEffective ? "Can use" : "Cannot use"}</span>
                                    </div>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 rounded-xl border border-line/60 bg-canvas-deep/70 px-3 py-2 text-[11px] text-muted">
                        <Info className="h-3.5 w-3.5 shrink-0" />
                        <span>
                          {feature.isUngated
                            ? "Always available. This is the screen that unlocks all features."
                            : "Not available within organization."}
                        </span>
                      </div>
                    )}

                    {/* Expanded details for mobile */}
                    {isExpanded && (
                      <div className="rounded-xl border border-line/60 bg-canvas-deep/40 p-3 text-[11px] text-muted space-y-1.5">
                        <div>
                          <span className="font-semibold text-ink">Key:</span>{" "}
                          <code className="font-mono">{feature.key}</code>
                        </div>
                        <div>
                          <span className="font-semibold text-ink">Source:</span>{" "}
                          <span>{feature.entitlementSource}</span>
                        </div>
                        <div>
                          <span className="font-semibold text-ink">Rule:</span>{" "}
                          <span>
                            {feature.inheritsWhenSilent
                              ? "Allowed by default (CORE)"
                              : "Denied until explicitly enabled (PREMIUM)"}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
