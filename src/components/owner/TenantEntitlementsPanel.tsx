"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  BarChart3,
  Bell,
  BellOff,
  Building2,
  Calendar,
  CheckSquare,
  Clock,
  Heart,
  HelpCircle,
  Info,
  Layers,
  LayoutGrid,
  Megaphone,
  MessageSquare,
  PhoneCall,
  RotateCcw,
  Settings,
  Sliders,
  SlidersHorizontal,
  User,
  Users,
} from "lucide-react";
import Select from "@/components/ui/Select";
import type { TenantEntitlementView } from "@/lib/platform/entitlements";
import { MIN_REASON_LENGTH } from "@/lib/platform/entitlementPolicy";
import { cx } from "@/components/ui";

interface RecentChangeItem {
  id: string;
  action: string;
  reason: string | null;
  createdAt: Date;
  actorName: string | null;
}

interface TenantEntitlementsPanelProps {
  view: TenantEntitlementView;
  clinicCreatedAt?: Date | null;
  recentChanges?: RecentChangeItem[];
}

const GENERIC_ERROR = "Could not save those entitlements. Try again.";

function getFeatureIcon(key: string) {
  switch (key) {
    case "clinics":
      return Building2;
    case "doctors":
      return PhoneCall;
    case "notifications":
      return Bell;
    case "registrations":
      return User;
    case "reports":
      return BarChart3;
    case "settings":
      return Settings;
    case "tasks":
      return CheckSquare;
    case "team":
      return Users;
    case "whatsapp":
      return MessageSquare;
    case "appointments":
      return Calendar;
    case "ivr":
      return PhoneCall;
    case "marketing":
      return Megaphone;
    default:
      return LayoutGrid;
  }
}

function formatDate(date: Date): string {
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  return `${months[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()}`;
}

export default function TenantEntitlementsPanel({
  view,
  clinicCreatedAt,
  recentChanges = [],
}: TenantEntitlementsPanelProps) {
  const router = useRouter();

  const selectablePlans = useMemo(
    () => view.plans.filter((plan) => plan.isActive || plan.key === view.planKey),
    [view.plans, view.planKey],
  );

  const [planKey, setPlanKey] = useState<string>(
    view.planKey ?? selectablePlans[0]?.key ?? "",
  );
  const [ticks, setTicks] = useState<Record<string, boolean>>({});
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  /** What the CURRENTLY SELECTED plan grants, keyed by feature. */
  const planDefaults = useMemo(() => {
    const plan = view.plans.find((option) => option.key === planKey);
    return new Set((plan?.features ?? []).map((row) => row.key));
  }, [view.plans, planKey]);

  function isEnabled(key: string): boolean {
    if (key in ticks) {
      return ticks[key];
    }
    const stored = view.features.find((feature) => feature.key === key);
    if (stored?.override !== null && stored?.override !== undefined) {
      return stored.override;
    }
    return planDefaults.has(key);
  }

  const deviations = view.features.filter(
    (feature) => isEnabled(feature.key) !== planDefaults.has(feature.key),
  );
  const planChanged = planKey !== (view.planKey ?? "");
  const needsReason = deviations.some(
    (feature) => feature.override !== isEnabled(feature.key),
  );
  const reasonLongEnough = reason.trim().length >= MIN_REASON_LENGTH;
  const dirty =
    planChanged ||
    view.features.some((feature) => {
      const enabled = isEnabled(feature.key);
      const agreesWithPlan = enabled === planDefaults.has(feature.key);
      return agreesWithPlan
        ? feature.override !== null
        : feature.override !== enabled;
    });

  // Derived Entitlement Statistics
  const totalFeatures = view.features.length;
  const enabledCount = view.features.filter(
    (f) => isEnabled(f.key) && f.globalEnabled,
  ).length;
  const disabledCount = totalFeatures - enabledCount;
  const followingPlanCount = view.features.filter((f) => {
    const planGrants = planDefaults.has(f.key);
    const enabled = isEnabled(f.key);
    return enabled === planGrants;
  }).length;
  const overrideCount = totalFeatures - followingPlanCount;

  async function submit() {
    setPending(true);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch(
        `/api/owner/applications/${view.tenantId}/entitlements`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            planKey: planKey || undefined,
            features: view.features.map((feature) => ({
              featureKey: feature.key,
              enabled: isEnabled(feature.key),
            })),
            reason: reason.trim() || undefined,
          }),
        },
      );

      const body: {
        success?: boolean;
        error?: string;
        data?: {
          planChanged?: boolean;
          overridesSet?: number;
          overridesCleared?: number;
        };
      } = await response.json().catch(() => ({}));

      if (!response.ok || !body.success) {
        setError(body.error ?? GENERIC_ERROR);
        return;
      }

      const set = body.data?.overridesSet ?? 0;
      const cleared = body.data?.overridesCleared ?? 0;
      setNotice(
        set === 0 && cleared === 0 && body.data?.planChanged !== true
          ? "Nothing to change — this organisation already matches what is on screen."
          : `Saved. ${set} override${set === 1 ? "" : "s"} written, ${cleared} cleared${body.data?.planChanged ? ", plan changed" : ""}.`,
      );
      setTicks({});
      setReason("");
      router.refresh();
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
      {/* Left / Main Content ~70% (8 cols) */}
      <div className="lg:col-span-8 space-y-5">
        {/* Main Plan & Entitlements Card */}
        <section className="rounded-2xl border border-slate-800/80 bg-[#0d1427]/85 p-5 sm:p-6 shadow-lg backdrop-blur-md space-y-5">
          {/* Header */}
          <div>
            <h2 className="text-base font-bold text-white tracking-tight">
              Plan and entitlements
            </h2>
            <p className="mt-1 text-xs text-slate-400 leading-relaxed">
              Layers 1 and 2 of four. What each role in the organisation may then use is
              the organisation admin&rsquo;s own setting, and nothing here changes it.
            </p>
          </div>

          {error && (
            <div
              role="alert"
              className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3.5 text-xs text-rose-300"
            >
              {error}
            </div>
          )}
          {notice && (
            <div
              role="status"
              className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3.5 text-xs text-emerald-300"
            >
              {notice}
            </div>
          )}

          {/* Plan Selector */}
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-2">
              Plan
            </label>
            <div className="w-full">
              <Select
                id="tenantPlan"
                label="Plan"
                isLabelHidden
                value={planKey}
                onChange={(event) => setPlanKey(event.target.value)}
              >
                {selectablePlans.length === 0 && <option value="">No plans</option>}
                {selectablePlans.map((plan) => (
                  <option key={plan.key} value={plan.key}>
                    {plan.name}
                    {plan.isActive ? "" : " (retired)"}
                  </option>
                ))}
              </Select>
            </div>
            {planChanged && (
              <p className="mt-1.5 text-[11px] text-amber-400">
                Changing the plan re-evaluates every feature you have not ticked
                yourself.
              </p>
            )}
          </div>

          {/* Features Section */}
          <div className="pt-2">
            <h3 className="text-sm font-bold text-white">Features</h3>
            <p className="mt-0.5 text-xs text-slate-400">
              A tick that matches the plan clears any override, so the organisation
              keeps following the plan when it changes. A tick that differs is stored
              as an override and needs a reason.
            </p>

            {/* 2-Column Responsive Feature Cards Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 mt-3.5">
              {view.features.map((feature) => {
                const planGrants = planDefaults.has(feature.key);
                const enabled = isEnabled(feature.key);
                const deviates = enabled !== planGrants;
                const Icon = getFeatureIcon(feature.key);

                return (
                  <label
                    key={feature.key}
                    className={cx(
                      "flex items-center justify-between gap-2.5 rounded-xl border p-3 text-xs transition-all duration-150 select-none",
                      !feature.globalEnabled
                        ? "border-slate-800/60 bg-[#090e23]/40 text-slate-500 opacity-60 cursor-not-allowed"
                        : enabled
                          ? "border-slate-800/90 bg-[#090e23]/80 hover:border-slate-700 text-white cursor-pointer"
                          : "border-slate-800/60 bg-[#090e23]/50 text-slate-400 hover:border-slate-700 cursor-pointer",
                    )}
                  >
                    {/* Left: Icon + Checkbox + Name + Badges */}
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-800 bg-[#070b1a] text-indigo-400">
                        <Icon className="h-4 w-4" />
                      </div>

                      <input
                        type="checkbox"
                        checked={enabled}
                        disabled={!feature.globalEnabled}
                        onChange={(event) =>
                          setTicks((current) => ({
                            ...current,
                            [feature.key]: event.target.checked,
                          }))
                        }
                        className="h-4 w-4 rounded border-slate-700 bg-slate-900 text-indigo-600 focus:ring-0 focus:ring-offset-0 cursor-pointer disabled:cursor-not-allowed shrink-0"
                      />

                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-semibold text-xs text-white truncate">
                            {feature.name}
                          </span>
                          {feature.tier !== "CORE" && (
                            <span className="rounded border border-slate-700 bg-slate-800/90 px-1.5 py-0.2 text-[9px] font-bold uppercase tracking-wider text-slate-300">
                              {feature.tier}
                            </span>
                          )}
                          {!feature.isEnforced && (
                            <span className="rounded border border-slate-800 bg-slate-900/60 px-1 py-0.2 text-[9px] text-slate-500">
                              not enforced
                            </span>
                          )}
                        </div>
                        {!feature.globalEnabled && (
                          <span className="text-[10px] text-slate-500 block mt-0.5 truncate">
                            Switched off platform-wide &mdash; no plan or override can grant it.
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Right: State Label */}
                    <div className="shrink-0 text-right">
                      {feature.globalEnabled ? (
                        deviates ? (
                          <span className="text-[11px] font-medium text-amber-400">
                            Override
                          </span>
                        ) : (
                          <span className="text-[11px] text-slate-500">
                            Follows the plan
                          </span>
                        )
                      ) : null}
                    </div>
                  </label>
                );
              })}
            </div>
          </div>

          {/* Reason Field */}
          <div className="space-y-1.5 pt-2 border-t border-slate-800/60">
            <label
              htmlFor="entitlementReason"
              className="block text-xs font-semibold text-slate-300"
            >
              Reason{" "}
              {needsReason ? (
                <span className="text-amber-400 font-normal">
                  (required, at least {MIN_REASON_LENGTH} characters)
                </span>
              ) : (
                <span className="text-slate-500 font-normal">(optional)</span>
              )}
            </label>
            <textarea
              id="entitlementReason"
              rows={2}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="e.g. Pilot customer — WhatsApp enabled ahead of their plan"
              className="w-full rounded-xl border border-slate-800 bg-[#090e23]/80 px-3.5 py-2.5 text-xs sm:text-sm text-white placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-indigo-500/50 resize-none transition-all"
            />
          </div>

          {/* Actions Row */}
          <div className="flex flex-wrap items-center gap-3 pt-2">
            <button
              type="button"
              disabled={pending || !dirty || (needsReason && !reasonLongEnough)}
              onClick={submit}
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 via-indigo-500 to-purple-600 px-5 py-2.5 text-xs font-semibold text-white shadow-md shadow-indigo-600/25 hover:from-indigo-500 hover:to-purple-500 active:scale-[0.99] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <span>{pending ? "Saving…" : "Save entitlements"}</span>
            </button>

            <button
              type="button"
              disabled={pending || (Object.keys(ticks).length === 0 && !planChanged)}
              onClick={() => {
                setTicks({});
                setPlanKey(view.planKey ?? selectablePlans[0]?.key ?? "");
                setReason("");
                setError(null);
                setNotice(null);
              }}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-800 bg-[#090e23]/60 px-4 py-2.5 text-xs font-medium text-slate-400 hover:bg-slate-800/40 hover:text-white transition-colors disabled:opacity-50"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>Discard changes</span>
            </button>
          </div>
        </section>

        {/* Bottom Informational Banner */}
        <div className="rounded-2xl border border-slate-800/80 bg-[#0d1427]/60 p-4 shadow-sm flex items-start gap-3">
          <Info className="h-4 w-4 text-indigo-400 shrink-0 mt-0.5" />
          <p className="text-xs text-slate-400 leading-relaxed">
            Revoking a feature leaves this organisation&rsquo;s per-role settings
            untouched. They stop mattering while the entitlement is gone and take
            effect again if it is restored, so a revoke followed by a restore does not
            quietly hand the module to every role.
          </p>
        </div>
      </div>

      {/* Right / Information Rail ~30% (4 cols) */}
      <div className="lg:col-span-4 space-y-5">
        {/* Card A: Entitlement Summary */}
        <section className="rounded-2xl border border-slate-800/80 bg-[#0d1427]/85 p-5 shadow-lg backdrop-blur-md space-y-4">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-400">
            <SlidersHorizontal className="h-4 w-4 text-indigo-400" />
            <span>Entitlement summary</span>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            {/* Stat 1: Total */}
            <div className="rounded-xl border border-slate-800 bg-[#090e23]/80 p-3">
              <span className="text-lg font-bold text-white tabular-nums block">
                {totalFeatures}
              </span>
              <span className="text-[11px] text-slate-400 mt-0.5 block">
                Total features
              </span>
            </div>

            {/* Stat 2: Enabled */}
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/20 p-3">
              <span className="text-lg font-bold text-emerald-400 tabular-nums block">
                {enabledCount}
              </span>
              <span className="text-[11px] text-emerald-300/80 mt-0.5 block">
                Enabled
              </span>
            </div>

            {/* Stat 3: Disabled */}
            <div className="rounded-xl border border-rose-500/30 bg-rose-950/20 p-3">
              <span className="text-lg font-bold text-rose-400 tabular-nums block">
                {disabledCount}
              </span>
              <span className="text-[11px] text-rose-300/80 mt-0.5 block">
                Disabled
              </span>
            </div>

            {/* Stat 4: Following plan */}
            <div className="rounded-xl border border-indigo-500/30 bg-indigo-950/20 p-3">
              <span className="text-lg font-bold text-indigo-400 tabular-nums block">
                {followingPlanCount}
              </span>
              <span className="text-[11px] text-indigo-300/80 mt-0.5 block">
                Following plan
              </span>
            </div>

            {/* Stat 5: Overrides (full width across 2 cols) */}
            <div className="col-span-2 rounded-xl border border-purple-500/30 bg-purple-950/20 p-3">
              <span className="text-lg font-bold text-purple-400 tabular-nums block">
                {overrideCount}
              </span>
              <span className="text-[11px] text-purple-300/80 mt-0.5 block">
                Overrides
              </span>
            </div>
          </div>
        </section>

        {/* Card B: How this works */}
        <section className="rounded-2xl border border-slate-800/80 bg-[#0d1427]/85 p-5 shadow-lg backdrop-blur-md space-y-4">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-400">
            <HelpCircle className="h-4 w-4 text-indigo-400" />
            <span>How this works</span>
          </div>

          <div className="space-y-3.5 text-xs text-slate-300">
            <div className="flex items-start gap-2.5">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-slate-800 bg-[#090e23] text-indigo-400 mt-0.5">
                <Layers className="h-3.5 w-3.5" />
              </div>
              <div>
                <span className="font-semibold text-white block">
                  Plan inheritance
                </span>
                <span className="text-[11px] text-slate-400 mt-0.5 block leading-relaxed">
                  Features follow the selected plan by default. This keeps clinics
                  consistent as plans evolve.
                </span>
              </div>
            </div>

            <div className="flex items-start gap-2.5">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-slate-800 bg-[#090e23] text-indigo-400 mt-0.5">
                <Sliders className="h-3.5 w-3.5" />
              </div>
              <div>
                <span className="font-semibold text-white block">Overrides</span>
                <span className="text-[11px] text-slate-400 mt-0.5 block leading-relaxed">
                  Unticking or enabling a different feature creates an override that
                  stays until you change it.
                </span>
              </div>
            </div>

            <div className="flex items-start gap-2.5">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-slate-800 bg-[#090e23] text-indigo-400 mt-0.5">
                <BellOff className="h-3.5 w-3.5" />
              </div>
              <div>
                <span className="font-semibold text-white block">
                  Platform-wide disabled
                </span>
                <span className="text-[11px] text-slate-400 mt-0.5 block leading-relaxed">
                  Some features are switched off at the platform level and cannot be
                  enabled for any clinic.
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* Card C: Clinic Status */}
        <section className="rounded-2xl border border-slate-800/80 bg-[#0d1427]/85 p-5 shadow-lg backdrop-blur-md space-y-3.5">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-400">
            <Heart className="h-4 w-4 text-indigo-400" />
            <span>Clinic status</span>
          </div>

          <div className="space-y-2.5 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Status</span>
              <span className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-400 capitalize">
                {view.status.toLowerCase()}
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-slate-400">Plan</span>
              <span className="font-semibold text-white">
                {view.planName ?? "None"}
              </span>
            </div>

            {clinicCreatedAt && (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Joined</span>
                  <span className="font-mono text-slate-300">
                    {formatDate(clinicCreatedAt)}
                  </span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Plan since</span>
                  <span className="font-mono text-slate-300">
                    {formatDate(clinicCreatedAt)}
                  </span>
                </div>
              </>
            )}
          </div>
        </section>

        {/* Card D: Recent Changes */}
        <section className="rounded-2xl border border-slate-800/80 bg-[#0d1427]/85 p-5 shadow-lg backdrop-blur-md space-y-3.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-400">
              <Clock className="h-4 w-4 text-indigo-400" />
              <span>Recent changes</span>
            </div>
            <Link
              href="/owner/audit"
              className="text-[11px] font-semibold text-indigo-400 hover:text-indigo-300 transition-colors"
            >
              View all
            </Link>
          </div>

          {recentChanges.length === 0 ? (
            <p className="text-xs text-slate-500 py-1">
              No recent entitlement changes
            </p>
          ) : (
            <div className="space-y-2 text-xs">
              {recentChanges.map((change) => (
                <div
                  key={change.id}
                  className="rounded-xl border border-slate-800 bg-[#090e23]/70 p-2.5 space-y-1"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[11px] font-semibold text-slate-300">
                      {change.action}
                    </span>
                    <span className="text-[10px] text-slate-500 font-mono">
                      {formatDate(change.createdAt)}
                    </span>
                  </div>
                  {change.reason && (
                    <p className="text-[11px] text-slate-400 truncate">
                      {change.reason}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
