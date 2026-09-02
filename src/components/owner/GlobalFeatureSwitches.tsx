"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  BarChart3,
  Bell,
  Building2,
  Calendar,
  CheckSquare,
  LayoutGrid,
  Megaphone,
  MessageSquare,
  Power,
  PowerOff,
  Settings,
  UserCheck,
  UserRound,
  Users,
} from "lucide-react";
import type { PlatformFeatureRow } from "@/lib/platform/entitlements";
import { MIN_REASON_LENGTH } from "@/lib/platform/entitlementPolicy";
import { cx } from "@/components/ui";

/**
 * The platform-wide kill switch — Stage 9, layer 1.
 *
 * A convenience layer over the API and nothing more. Every rule it enforces —
 * that a reason is required in both directions, that switching off needs the
 * feature key typed out — is enforced again in
 * src/lib/platform/entitlementPolicy.ts, which is the copy that counts.
 *
 * WHY THE CONFIRMATION IS A TEXT FIELD AND NOT A CHECKBOX. A checkbox beside a
 * button gets ticked on the way to pressing the button. Typing `registrations`
 * cannot be done without reading which feature is about to go dark for every
 * clinic on the platform, which is the entire purpose of the step.
 *
 * The affected-organisation count is rendered whether or not the form is open,
 * because the decision to open it is the one the number should inform.
 */

interface GlobalFeatureSwitchesProps {
  features: PlatformFeatureRow[];
  totalCustomerTenants: number;
}

const TIER_STYLES: Record<string, string> = {
  CORE: "border-slate-700/60 bg-slate-900/60 text-slate-400",
  PREMIUM: "border-indigo-500/30 bg-indigo-950/60 text-indigo-300",
  BETA: "border-amber-500/30 bg-amber-950/60 text-amber-300",
  INTERNAL: "border-rose-500/30 bg-rose-950/60 text-rose-300",
};

const GENERIC_ERROR = "Could not change that switch. Try again.";

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
    case "marketing":
      return Megaphone;
    default:
      return LayoutGrid;
  }
}

export default function GlobalFeatureSwitches({
  features,
  totalCustomerTenants,
}: GlobalFeatureSwitchesProps) {
  const router = useRouter();

  const [openKey, setOpenKey] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function open(featureKey: string) {
    setOpenKey(featureKey);
    setReason("");
    setConfirmation("");
    setError(null);
    setNotice(null);
  }

  function close() {
    setOpenKey(null);
    setReason("");
    setConfirmation("");
  }

  async function submit(feature: PlatformFeatureRow) {
    const enabled = !feature.globalEnabled;
    setPending(true);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch("/api/owner/features", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          featureKey: feature.key,
          enabled,
          reason: reason.trim() || undefined,
          confirmation: confirmation.trim() || undefined,
        }),
      });

      const body: {
        success?: boolean;
        error?: string;
        data?: { affectedTenants?: number; isEnforced?: boolean };
      } = await response.json().catch(() => ({}));

      if (!response.ok || !body.success) {
        setError(body.error ?? GENERIC_ERROR);
        return;
      }

      const affected = body.data?.affectedTenants ?? 0;
      setNotice(
        body.data?.isEnforced === false
          ? `${feature.name} is now ${enabled ? "on" : "off"}. Nothing checks this key yet, so no clinic will notice.`
          : `${feature.name} is now ${enabled ? "on" : "off"} for ${affected} organisation${affected === 1 ? "" : "s"}.`,
      );
      close();
      router.refresh();
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  }

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

      {/* 2-Column Responsive Grid on Desktop */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {features.map((feature) => {
          const Icon = getFeatureIcon(feature.key);
          const isOpen = openKey === feature.key;
          const switchingOff = feature.globalEnabled;
          const confirmed = !switchingOff || confirmation.trim() === feature.key;
          const reasonLongEnough = reason.trim().length >= MIN_REASON_LENGTH;

          return (
            <div
              key={feature.key}
              className={cx(
                "group relative flex flex-col justify-between rounded-2xl border bg-[#0d1427]/85 p-5 sm:p-6 shadow-lg backdrop-blur-md transition-all duration-150",
                isOpen
                  ? "border-indigo-500/50 shadow-indigo-500/10"
                  : "border-slate-800/80 hover:border-slate-700 hover:-translate-y-0.5",
              )}
            >
              <div>
                {/* Header Row: Left info lockup + Right Action Button */}
                <div className="flex items-start justify-between gap-4">
                  {/* Left Info */}
                  <div className="flex items-start gap-4 min-w-0">
                    <div className="flex h-11 w-11 sm:h-12 sm:w-12 shrink-0 items-center justify-center rounded-xl border border-indigo-500/20 bg-indigo-950/60 text-indigo-400 shadow-sm transition-transform duration-150 group-hover:scale-105">
                      <Icon className="h-5 w-5 sm:h-6 sm:w-6" />
                    </div>

                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-sm sm:text-base font-semibold text-white tracking-tight">
                          {feature.name}
                        </h2>
                        <code className="rounded bg-slate-900/80 px-1.5 py-0.5 font-mono text-[11px] text-slate-400 border border-slate-800">
                          {feature.key}
                        </code>
                        <span
                          className={cx(
                            "rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
                            TIER_STYLES[feature.tier] ?? TIER_STYLES.CORE,
                          )}
                        >
                          {feature.tier}
                        </span>
                        <span
                          className={cx(
                            "rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
                            feature.globalEnabled
                              ? "border-emerald-500/30 bg-emerald-950/60 text-emerald-300"
                              : "border-rose-500/30 bg-rose-950/60 text-rose-300",
                          )}
                        >
                          {feature.globalEnabled ? "Live" : "Switched off"}
                        </span>
                      </div>

                      {feature.description && (
                        <p className="mt-2 text-xs text-slate-400 leading-relaxed line-clamp-2">
                          {feature.description}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Right Action Button */}
                  {!isOpen && (
                    <div className="shrink-0">
                      {feature.globalEnabled ? (
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => open(feature.key)}
                          className="inline-flex items-center gap-2.5 rounded-xl border border-rose-500/30 bg-rose-950/30 px-3.5 py-2 text-left text-xs font-semibold text-rose-300 hover:bg-rose-900/40 hover:border-rose-500/50 active:scale-[0.99] transition-all disabled:opacity-50"
                        >
                          <PowerOff className="h-4 w-4 text-rose-400 shrink-0" />
                          <div className="leading-tight text-[11px]">
                            <span className="block font-semibold">Switch off</span>
                            <span className="block text-[10px] text-rose-400/80 font-normal">
                              platform-wide
                            </span>
                          </div>
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => open(feature.key)}
                          className="inline-flex items-center gap-2.5 rounded-xl border border-emerald-500/30 bg-emerald-950/30 px-3.5 py-2 text-left text-xs font-semibold text-emerald-300 hover:bg-emerald-900/40 hover:border-emerald-500/50 active:scale-[0.99] transition-all disabled:opacity-50"
                        >
                          <Power className="h-4 w-4 text-emerald-400 shrink-0" />
                          <div className="leading-tight text-[11px]">
                            <span className="block font-semibold">Switch on</span>
                            <span className="block text-[10px] text-emerald-400/80 font-normal">
                              platform-wide
                            </span>
                          </div>
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/* Entitlement & Plan Context */}
                <div className="mt-3.5 flex items-center gap-1.5 text-xs text-slate-400">
                  <Users className="h-3.5 w-3.5 text-slate-500 shrink-0" />
                  <span>
                    <strong className="text-slate-200 font-semibold tabular-nums">
                      {feature.entitledTenants}
                    </strong>{" "}
                    of{" "}
                    <strong className="text-slate-200 font-semibold tabular-nums">
                      {totalCustomerTenants}
                    </strong>{" "}
                    organisation{totalCustomerTenants === 1 ? "" : "s"} entitled
                    {feature.plansIncluding.length > 0
                      ? ` \u00B7 in ${feature.plansIncluding.join(", ")}`
                      : " \u00B7 in no plan"}
                  </span>
                </div>

                {/* Not Enforced Alert */}
                {!feature.isEnforced && (
                  <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-950/40 p-2.5 text-[11px] text-amber-300">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
                    <span>
                      Nothing checks this key, so switching it changes nothing today.{" "}
                      {feature.enforcementNote}
                    </span>
                  </div>
                )}
              </div>

              {/* Inline Expandable Decision Drawer */}
              {isOpen && (
                <div className="mt-4 rounded-xl border border-indigo-500/30 bg-[#080d1e] p-4 sm:p-5 shadow-lg space-y-4">
                  {switchingOff ? (
                    <div className="flex items-start gap-3 rounded-xl border border-rose-500/30 bg-rose-950/40 p-3.5 text-xs text-rose-300">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
                      <p className="leading-relaxed">
                        This removes <strong className="text-white font-semibold">{feature.name}</strong> from{" "}
                        <span className="font-bold text-white tabular-nums">
                          {feature.entitledTenants}
                        </span>{" "}
                        organisation{feature.entitledTenants === 1 ? "" : "s"} the moment it saves. No plan, override or role can reach past it, and nobody in those organisations can restore it themselves.
                      </p>
                    </div>
                  ) : (
                    <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/40 p-3.5 text-xs text-emerald-300 leading-relaxed">
                      Restoring <strong className="text-white font-semibold">{feature.name}</strong> re-enables it for every organisation entitled at layer 2.
                    </div>
                  )}

                  <div>
                    <label
                      htmlFor={`reason-${feature.key}`}
                      className="block text-xs font-medium text-slate-300"
                    >
                      Reason{" "}
                      <span className="text-slate-500">
                        (required, at least {MIN_REASON_LENGTH} characters)
                      </span>
                    </label>
                    <textarea
                      id={`reason-${feature.key}`}
                      rows={2}
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                      placeholder={
                        switchingOff
                          ? "e.g. BSP outage — suspending outbound messaging until resolved"
                          : "e.g. BSP outage resolved, messaging restored"
                      }
                      className="mt-1.5 w-full rounded-xl border border-slate-700/80 bg-slate-900/80 px-3.5 py-2 text-xs sm:text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500/50"
                    />
                  </div>

                  {switchingOff && (
                    <div>
                      <label
                        htmlFor={`confirm-${feature.key}`}
                        className="block text-xs font-medium text-slate-300"
                      >
                        Type <code className="text-indigo-300 font-mono font-bold">{feature.key}</code> to confirm
                      </label>
                      <input
                        id={`confirm-${feature.key}`}
                        type="text"
                        autoComplete="off"
                        value={confirmation}
                        placeholder={feature.key}
                        onChange={(event) => setConfirmation(event.target.value)}
                        className="mt-1.5 w-full rounded-xl border border-slate-700/80 bg-slate-900/80 px-3.5 py-2 font-mono text-xs sm:text-sm text-white placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-indigo-500/50"
                      />
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-2.5 pt-1">
                    <button
                      type="button"
                      disabled={pending || !confirmed || !reasonLongEnough}
                      onClick={() => submit(feature)}
                      className={cx(
                        "rounded-xl px-4 py-2 text-xs font-semibold text-white shadow-md transition-all",
                        switchingOff
                          ? "bg-rose-600 hover:bg-rose-500 disabled:bg-rose-950/60 disabled:text-rose-400"
                          : "bg-gradient-to-r from-indigo-600 via-indigo-500 to-purple-600 hover:from-indigo-500 hover:to-purple-500 disabled:opacity-50",
                        "disabled:cursor-not-allowed",
                      )}
                    >
                      {pending
                        ? "Saving…"
                        : switchingOff
                          ? `Switch ${feature.key} off`
                          : `Switch ${feature.key} on`}
                    </button>
                    <button
                      type="button"
                      onClick={close}
                      disabled={pending}
                      className="rounded-xl border border-slate-700 bg-slate-800/80 px-4 py-2 text-xs font-medium text-slate-300 hover:bg-slate-700 hover:text-white transition-colors disabled:opacity-50"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
