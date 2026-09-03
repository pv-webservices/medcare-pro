"use client";

import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  BarChart3,
  Bell,
  Building2,
  Calendar,
  CheckSquare,
  Layers,
  LayoutGrid,
  Megaphone,
  MessageSquare,
  PhoneCall,
  Settings,
  UserCheck,
  UserRound,
  Users,
} from "lucide-react";
import type { PlanAdminRow } from "@/lib/platform/entitlements";
import { MIN_REASON_LENGTH } from "@/lib/platform/entitlementPolicy";
import { cx } from "@/components/ui";

/**
 * What each plan includes — Stage 9, layer 2a.
 *
 * ONE CHANGE AT A TIME, not a screenful of checkboxes and a Save button. Each
 * add or removal moves every organisation on the plan that has no override, so
 * each is its own decision: its own reason, its own audit row, its own count of
 * who it moved. A batched save would put one reason against several changes and
 * leave nobody able to say which it was written about.
 *
 * Removing asks for a reason; adding does not. That matches the Stage 3
 * precedent — taking access away must be explained, restoring it need not be —
 * and it is enforced server-side in evaluatePlanFeature, not here.
 */

interface PlanFeatureEditorProps {
  plans: PlanAdminRow[];
}

const GENERIC_ERROR = "Could not change that plan. Try again.";

interface PendingChange {
  planKey: string;
  featureKey: string;
  featureName: string;
  included: boolean;
  tenantCount: number;
}

function getFeatureIcon(key: string) {
  switch (key) {
    case "clinics":
      return Building2;
    case "doctors":
      return UserRound;
    case "notifications":
      return Bell;
    case "registrations":
      return UserCheck;
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

export default function PlanFeatureEditor({ plans }: PlanFeatureEditorProps) {
  const router = useRouter();

  const [change, setChange] = useState<PendingChange | null>(null);
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function begin(next: PendingChange) {
    setChange(next);
    setReason("");
    setError(null);
    setNotice(null);
  }

  async function submit() {
    if (!change) {
      return;
    }

    setPending(true);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch("/api/owner/plans", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          planKey: change.planKey,
          featureKey: change.featureKey,
          included: change.included,
          reason: reason.trim() || undefined,
        }),
      });

      const body: {
        success?: boolean;
        error?: string;
        data?: { affectedTenants?: number };
      } = await response.json().catch(() => ({}));

      if (!response.ok || !body.success) {
        setError(body.error ?? GENERIC_ERROR);
        return;
      }

      const affected = body.data?.affectedTenants ?? 0;
      setNotice(
        `${change.featureName} is ${change.included ? "now in" : "no longer in"} the plan. ${affected} organisation${affected === 1 ? "" : "s"} followed the change.`,
      );
      setChange(null);
      setReason("");
      router.refresh();
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  }

  const isRemoval = change?.included === false;
  const reasonLongEnough = reason.trim().length >= MIN_REASON_LENGTH;

  return (
    <div className="space-y-6">
      {/* Alert Notices */}
      {error && (
        <div
          role="alert"
          className="rounded-xl border border-rose-500/30 bg-rose-950/60 p-4 text-xs font-medium text-rose-300 shadow-lg backdrop-blur-md"
        >
          {error}
        </div>
      )}
      {notice && (
        <div
          role="status"
          className="rounded-xl border border-emerald-500/30 bg-emerald-950/60 p-4 text-xs font-medium text-emerald-300 shadow-lg backdrop-blur-md"
        >
          {notice}
        </div>
      )}

      {plans.length === 0 && (
        <div className="rounded-2xl border border-slate-800/80 bg-[#0d1427]/85 p-8 text-center text-xs text-slate-400 shadow-lg backdrop-blur-md">
          No plans exist yet. Run the seed to create the standard plan.
        </div>
      )}

      {plans.map((plan) => (
        <div key={plan.key} className="space-y-5">
          {/* Prominent Plan Summary Card */}
          <div className="relative overflow-hidden rounded-2xl border border-indigo-500/30 bg-[#0d1427]/85 p-5 sm:p-6 shadow-xl backdrop-blur-md">
            {/* Ambient Indigo/Purple Glow */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -left-12 -top-12 h-36 w-36 rounded-full bg-gradient-to-r from-indigo-500/20 to-purple-600/20 blur-2xl"
            />

            <div className="relative flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              {/* Left Plan Lockup */}
              <div className="flex items-start gap-4 min-w-0">
                <div className="flex h-12 w-12 sm:h-14 sm:w-14 shrink-0 items-center justify-center rounded-2xl border border-indigo-500/20 bg-indigo-950/60 text-indigo-400 shadow-md shadow-indigo-500/10">
                  <Layers className="h-6 w-6 sm:h-7 sm:w-7" />
                </div>

                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <h2 className="text-lg sm:text-xl font-bold tracking-tight text-white">
                      {plan.name}
                    </h2>
                    {plan.isActive ? (
                      <span className="rounded-lg border border-indigo-500/30 bg-indigo-950/80 px-2.5 py-0.5 text-[11px] font-semibold text-indigo-300">
                        Active plan
                      </span>
                    ) : (
                      <span className="rounded-lg border border-slate-700/60 bg-slate-900/60 px-2.5 py-0.5 text-[11px] font-medium text-slate-400">
                        Retired
                      </span>
                    )}
                  </div>

                  {plan.description && (
                    <p className="mt-1 text-xs sm:text-sm text-slate-400 leading-relaxed">
                      {plan.description}
                    </p>
                  )}
                </div>
              </div>

              {/* Right Organisation Count */}
              <div className="flex items-center gap-2 text-xs sm:text-sm text-slate-300 font-medium shrink-0 md:pl-4">
                <Users className="h-4 w-4 text-slate-400 shrink-0" />
                <span>
                  <strong className="font-bold text-white tabular-nums">{plan.tenantCount}</strong> organisation{plan.tenantCount === 1 ? "" : "s"} on this plan
                </span>
              </div>
            </div>
          </div>

          {/* Features Table */}
          <div className="rounded-2xl border border-slate-800/80 bg-[#0d1427]/85 shadow-lg backdrop-blur-md overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse min-w-[620px]">
                <thead>
                  <tr className="border-b border-slate-800/80 bg-[#090e23]/60 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    <th className="py-3.5 px-6 font-semibold">Feature</th>
                    <th className="py-3.5 px-6 font-semibold">Slug</th>
                    <th className="py-3.5 px-6 font-semibold">Status</th>
                    <th className="py-3.5 px-6 font-semibold text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/50 text-xs sm:text-sm">
                  {plan.features.map((feature) => {
                    const Icon = getFeatureIcon(feature.key);
                    const isTarget =
                      change?.planKey === plan.key && change.featureKey === feature.key;

                    return (
                      <Fragment key={feature.key}>
                        <tr className="hover:bg-slate-800/30 transition-colors group">
                          {/* Feature Name & Icon */}
                          <td className="py-3 px-6 text-white font-medium">
                            <div className="flex items-center gap-3">
                              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-indigo-500/20 bg-indigo-950/60 text-indigo-400">
                                <Icon className="h-4 w-4" />
                              </div>
                              <span className="font-semibold text-slate-100 group-hover:text-white transition-colors">
                                {feature.name}
                              </span>
                              {!feature.globalEnabled && (
                                <span className="ml-1 rounded border border-rose-500/30 bg-rose-950/40 px-1.5 py-0.5 text-[10px] font-medium text-rose-400">
                                  off platform-wide
                                </span>
                              )}
                            </div>
                          </td>

                          {/* Slug */}
                          <td className="py-3 px-6 text-slate-400 font-mono text-xs">
                            {feature.key}
                          </td>

                          {/* Status Badge */}
                          <td className="py-3 px-6">
                            {feature.included ? (
                              <span className="inline-block rounded-lg border border-emerald-500/30 bg-emerald-950/60 px-2.5 py-1 text-[11px] font-semibold text-emerald-300">
                                Included
                              </span>
                            ) : (
                              <span className="inline-block rounded-lg border border-slate-700/60 bg-slate-900/60 px-2.5 py-1 text-[11px] font-semibold text-slate-400">
                                Not included
                              </span>
                            )}
                          </td>

                          {/* Action */}
                          <td className="py-3 px-6 text-right">
                            {feature.included ? (
                              <button
                                type="button"
                                disabled={pending}
                                onClick={() =>
                                  begin({
                                    planKey: plan.key,
                                    featureKey: feature.key,
                                    featureName: feature.name,
                                    included: false,
                                    tenantCount: plan.tenantCount,
                                  })
                                }
                                className="inline-flex items-center justify-center rounded-xl border border-slate-800 bg-slate-900/60 px-3.5 py-1.5 text-xs font-medium text-slate-300 hover:border-slate-700 hover:bg-slate-800 hover:text-white transition-colors disabled:opacity-50"
                              >
                                Remove from plan
                              </button>
                            ) : (
                              <button
                                type="button"
                                disabled={pending}
                                onClick={() =>
                                  begin({
                                    planKey: plan.key,
                                    featureKey: feature.key,
                                    featureName: feature.name,
                                    included: true,
                                    tenantCount: plan.tenantCount,
                                  })
                                }
                                className="inline-flex items-center justify-center rounded-xl border border-indigo-500/40 bg-indigo-950/50 hover:bg-indigo-900/70 text-indigo-300 hover:text-white px-4 py-1.5 text-xs font-semibold shadow-xs transition-all disabled:opacity-50"
                              >
                                Add to plan
                              </button>
                            )}
                          </td>
                        </tr>

                        {/* Inline Expandable Decision Drawer */}
                        {isTarget && (
                          <tr className="bg-[#090e23]/80">
                            <td colSpan={4} className="p-4 sm:p-6 border-b border-indigo-500/30">
                              <div className="rounded-xl border border-indigo-500/30 bg-[#0d1427] p-5 shadow-lg space-y-4">
                                {isRemoval ? (
                                  <div className="flex items-start gap-3 text-xs text-amber-300 bg-amber-950/40 border border-amber-500/30 rounded-xl p-3.5">
                                    <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400 mt-0.5" />
                                    <p className="leading-relaxed">
                                      Removing <strong className="text-white font-semibold">{feature.name}</strong> takes it from every
                                      organisation on <strong className="text-white font-semibold">{plan.name}</strong> that has no override of
                                      its own &mdash; up to <span className="font-bold text-white tabular-nums">{plan.tenantCount}</span> organisation{plan.tenantCount === 1 ? "" : "s"}.
                                      Their per-role settings are left alone, so restoring the feature restores their choices with it.
                                    </p>
                                  </div>
                                ) : (
                                  <div className="text-xs text-slate-300 bg-indigo-950/40 border border-indigo-500/30 rounded-xl p-3.5 leading-relaxed">
                                    Adding <strong className="text-white font-semibold">{feature.name}</strong> grants it to every organisation
                                    on <strong className="text-white font-semibold">{plan.name}</strong> that has no override of its own.
                                    {feature.tier !== "CORE" &&
                                      " Because this is not a CORE feature, each organisation's admin still has to switch it on per role."}
                                  </div>
                                )}

                                <div>
                                  <label
                                    htmlFor={`plan-reason-${plan.key}-${feature.key}`}
                                    className="block text-xs font-medium text-slate-300"
                                  >
                                    Reason{" "}
                                    <span className="text-slate-500">
                                      {isRemoval
                                        ? `(required, at least ${MIN_REASON_LENGTH} characters)`
                                        : "(optional)"}
                                    </span>
                                  </label>
                                  <textarea
                                    id={`plan-reason-${plan.key}-${feature.key}`}
                                    rows={2}
                                    value={reason}
                                    placeholder={
                                      isRemoval
                                        ? "Provide a reason for removing this feature from the plan..."
                                        : "Optional note for the activity log..."
                                    }
                                    onChange={(event) => setReason(event.target.value)}
                                    className="mt-1.5 w-full rounded-xl border border-slate-700/80 bg-slate-900/80 px-3.5 py-2 text-xs sm:text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500/50"
                                  />
                                </div>

                                <div className="flex flex-wrap items-center gap-2.5 pt-1">
                                  <button
                                    type="button"
                                    disabled={pending || (isRemoval && !reasonLongEnough)}
                                    onClick={submit}
                                    className={cx(
                                      "rounded-xl px-4 py-2 text-xs font-semibold text-white shadow-md transition-all",
                                      isRemoval
                                        ? "bg-rose-600 hover:bg-rose-500 disabled:bg-rose-950/60 disabled:text-rose-400"
                                        : "bg-gradient-to-r from-indigo-600 via-indigo-500 to-purple-600 hover:from-indigo-500 hover:to-purple-500 disabled:opacity-50",
                                      "disabled:cursor-not-allowed"
                                    )}
                                  >
                                    {pending
                                      ? "Saving…"
                                      : isRemoval
                                        ? "Confirm & remove from plan"
                                        : "Confirm & add to plan"}
                                  </button>
                                  <button
                                    type="button"
                                    disabled={pending}
                                    onClick={() => setChange(null)}
                                    className="rounded-xl border border-slate-700 bg-slate-800/80 px-4 py-2 text-xs font-medium text-slate-300 hover:bg-slate-700 hover:text-white transition-colors disabled:opacity-50"
                                  >
                                    Cancel
                                  </button>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
