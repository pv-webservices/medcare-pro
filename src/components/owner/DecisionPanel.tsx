"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  CheckCircle2,
  Info,
  PauseCircle,
  RotateCcw,
  Scale,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import type {
  FeatureEntitlementView,
  PlanOption,
} from "@/lib/platform/applications";
import Select from "@/components/ui/Select";
import {
  CLINIC_DECISIONS,
  MIN_REASON_LENGTH,
  MAX_REASON_LENGTH,
  type ClinicDecision,
} from "@/lib/platform/decisionPolicy";
import type { TenantStatus } from "@prisma/client";
import { cx } from "@/components/ui";

interface DecisionPanelProps {
  tenantId: string;
  status: TenantStatus;
  emailVerified: boolean;
  plans: PlanOption[];
  currentPlanKey: string | null;
  features: FeatureEntitlementView[];
}

const GENERIC_ERROR = "Could not apply that decision. Try again.";

export default function DecisionPanel({
  tenantId,
  status,
  emailVerified,
  plans,
  currentPlanKey,
  features,
}: DecisionPanelProps) {
  const router = useRouter();

  const selectablePlans = useMemo(
    () => plans.filter((plan) => plan.isActive || plan.key === currentPlanKey),
    [plans, currentPlanKey],
  );

  const [selectedChoice, setSelectedChoice] = useState<ClinicDecision>(() => {
    if (status === "ACTIVE") return CLINIC_DECISIONS.SUSPEND;
    if (status === "SUSPENDED") return CLINIC_DECISIONS.REACTIVATE;
    return CLINIC_DECISIONS.APPROVE;
  });

  const [planKey, setPlanKey] = useState<string>(
    currentPlanKey ?? selectablePlans[0]?.key ?? "",
  );
  const [reason, setReason] = useState("");
  const [entitlementReason, setEntitlementReason] = useState("");
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [pending, setPending] = useState<ClinicDecision | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  /** What the CURRENTLY SELECTED plan grants, keyed by feature. */
  const planDefaults = useMemo(() => {
    const plan = plans.find((option) => option.key === planKey);
    return new Map((plan?.features ?? []).map((row) => [row.key, row.enabled]));
  }, [plans, planKey]);

  function isEnabled(feature: FeatureEntitlementView): boolean {
    if (feature.key in overrides) {
      return overrides[feature.key];
    }
    if (feature.override !== null) {
      return feature.override;
    }
    return planDefaults.get(feature.key) ?? false;
  }

  const deviations = features.filter(
    (feature) => isEnabled(feature) !== (planDefaults.get(feature.key) ?? false),
  );

  const needsEntitlementReason = deviations.length > 0;

  async function submit(decision: ClinicDecision) {
    setError(null);
    setNotice(null);
    setPending(decision);

    try {
      const response = await fetch(
        `/api/owner/applications/${tenantId}/decision`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            decision,
            reason: reason.trim() || undefined,
            ...(decision === CLINIC_DECISIONS.APPROVE
              ? {
                  planKey,
                  features: features.map((feature) => ({
                    featureKey: feature.key,
                    enabled: isEnabled(feature),
                  })),
                  entitlementReason: entitlementReason.trim() || undefined,
                }
              : {}),
          }),
        },
      );

      const body: { success?: boolean; error?: string; data?: { applicantNotified?: boolean } } =
        await response.json().catch(() => ({}));

      if (!response.ok || !body.success) {
        setError(body.error ?? GENERIC_ERROR);
        return;
      }

      if (body.data?.applicantNotified === false) {
        setNotice(
          "The decision was saved, but the notification email could not be sent. Contact the applicant directly.",
        );
      }

      setReason("");
      setEntitlementReason("");
      setOverrides({});
      router.refresh();
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setPending(null);
    }
  }

  if (status === "REJECTED" || status === "ARCHIVED") {
    return (
      <div className="rounded-2xl border border-slate-800/80 bg-[#0d1427]/85 p-6 shadow-lg backdrop-blur-md">
        <div className="flex items-center gap-3 text-slate-300">
          <Info className="h-5 w-5 text-slate-400" />
          <p className="text-xs sm:text-sm">
            This application is closed. Re-admitting a rejected applicant is a fresh
            registration, not a status change.
          </p>
        </div>
      </div>
    );
  }

  const isReasonRequired =
    selectedChoice === CLINIC_DECISIONS.REJECT ||
    selectedChoice === CLINIC_DECISIONS.SUSPEND;

  const isReasonTooShort =
    isReasonRequired &&
    reason.trim().length > 0 &&
    reason.trim().length < MIN_REASON_LENGTH;

  const isSubmitDisabled =
    pending !== null ||
    (isReasonRequired && reason.trim().length < MIN_REASON_LENGTH) ||
    (selectedChoice === CLINIC_DECISIONS.APPROVE &&
      (planKey === "" ||
        (needsEntitlementReason &&
          entitlementReason.trim().length < MIN_REASON_LENGTH)));

  return (
    <div className="space-y-5">
      {/* Make a Decision Card */}
      <section className="rounded-2xl border border-slate-800/80 bg-[#0d1427]/85 p-5 sm:p-6 shadow-lg backdrop-blur-md space-y-5">
        {/* Header */}
        <div className="flex items-start gap-3.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-700/60 bg-slate-800/50 text-indigo-400">
            <Scale className="h-4.5 w-4.5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-white tracking-tight">
              Make a decision
            </h2>
            <p className="mt-0.5 text-xs text-slate-400">
              This action will determine whether the clinic can access the platform.
            </p>
          </div>
        </div>

        {error && (
          <div
            role="alert"
            className="flex items-start gap-2.5 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3.5 text-xs text-rose-300"
          >
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-rose-400" />
            <span>{error}</span>
          </div>
        )}

        {notice && (
          <div
            role="status"
            className="flex items-start gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3.5 text-xs text-amber-300"
          >
            <Info className="h-4 w-4 shrink-0 mt-0.5 text-amber-400" />
            <span>{notice}</span>
          </div>
        )}

        {/* 3 Selectable Decision Cards */}
        <div>
          <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-2.5">
            Decision
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {/* Card 1: Approve */}
            <button
              type="button"
              onClick={() => {
                if (status === "PENDING" || status === "SUSPENDED") {
                  setSelectedChoice(
                    status === "SUSPENDED"
                      ? CLINIC_DECISIONS.REACTIVATE
                      : CLINIC_DECISIONS.APPROVE,
                  );
                } else {
                  setSelectedChoice(CLINIC_DECISIONS.APPROVE);
                }
              }}
              className={cx(
                "relative flex flex-col items-start p-3.5 rounded-xl border text-left transition-all duration-150 cursor-pointer",
                selectedChoice === CLINIC_DECISIONS.APPROVE ||
                  selectedChoice === CLINIC_DECISIONS.REACTIVATE
                  ? "border-emerald-500/70 bg-emerald-950/30 text-white ring-1 ring-emerald-500/30 shadow-md shadow-emerald-950/40"
                  : "border-slate-800 bg-[#090e23]/60 text-slate-400 hover:border-slate-700 hover:text-slate-300",
              )}
            >
              <div className="flex items-center justify-between w-full">
                <div className="flex items-center gap-2">
                  <CheckCircle2
                    className={cx(
                      "h-4 w-4",
                      selectedChoice === CLINIC_DECISIONS.APPROVE ||
                        selectedChoice === CLINIC_DECISIONS.REACTIVATE
                        ? "text-emerald-400"
                        : "text-slate-500",
                    )}
                  />
                  <span className="text-xs font-bold text-white">
                    {status === "SUSPENDED" ? "Reactivate" : "Approve"}
                  </span>
                </div>
                <span
                  className={cx(
                    "h-3 w-3 rounded-full border flex items-center justify-center",
                    selectedChoice === CLINIC_DECISIONS.APPROVE ||
                      selectedChoice === CLINIC_DECISIONS.REACTIVATE
                      ? "border-emerald-400 bg-emerald-400"
                      : "border-slate-600 bg-transparent",
                  )}
                />
              </div>
              <p className="mt-1.5 text-[11px] text-slate-400">
                {status === "SUSPENDED"
                  ? "Restore full access"
                  : "Allow full access"}
              </p>
            </button>

            {/* Card 2: Suspend */}
            <button
              type="button"
              onClick={() => setSelectedChoice(CLINIC_DECISIONS.SUSPEND)}
              className={cx(
                "relative flex flex-col items-start p-3.5 rounded-xl border text-left transition-all duration-150 cursor-pointer",
                selectedChoice === CLINIC_DECISIONS.SUSPEND
                  ? "border-amber-500/70 bg-amber-950/30 text-white ring-1 ring-amber-500/30 shadow-md shadow-amber-950/40"
                  : "border-slate-800 bg-[#090e23]/60 text-slate-400 hover:border-slate-700 hover:text-slate-300",
              )}
            >
              <div className="flex items-center justify-between w-full">
                <div className="flex items-center gap-2">
                  <PauseCircle
                    className={cx(
                      "h-4 w-4",
                      selectedChoice === CLINIC_DECISIONS.SUSPEND
                        ? "text-amber-400"
                        : "text-slate-500",
                    )}
                  />
                  <span className="text-xs font-bold text-white">Suspend</span>
                </div>
                <span
                  className={cx(
                    "h-3 w-3 rounded-full border flex items-center justify-center",
                    selectedChoice === CLINIC_DECISIONS.SUSPEND
                      ? "border-amber-400 bg-amber-400"
                      : "border-slate-600 bg-transparent",
                  )}
                />
              </div>
              <p className="mt-1.5 text-[11px] text-slate-400">
                Temporarily restrict access
              </p>
            </button>

            {/* Card 3: Reject */}
            <button
              type="button"
              onClick={() => setSelectedChoice(CLINIC_DECISIONS.REJECT)}
              className={cx(
                "relative flex flex-col items-start p-3.5 rounded-xl border text-left transition-all duration-150 cursor-pointer",
                selectedChoice === CLINIC_DECISIONS.REJECT
                  ? "border-rose-500/70 bg-rose-950/30 text-white ring-1 ring-rose-500/30 shadow-md shadow-rose-950/40"
                  : "border-slate-800 bg-[#090e23]/60 text-slate-400 hover:border-slate-700 hover:text-slate-300",
              )}
            >
              <div className="flex items-center justify-between w-full">
                <div className="flex items-center gap-2">
                  <XCircle
                    className={cx(
                      "h-4 w-4",
                      selectedChoice === CLINIC_DECISIONS.REJECT
                        ? "text-rose-400"
                        : "text-slate-500",
                    )}
                  />
                  <span className="text-xs font-bold text-white">Reject</span>
                </div>
                <span
                  className={cx(
                    "h-3 w-3 rounded-full border flex items-center justify-center",
                    selectedChoice === CLINIC_DECISIONS.REJECT
                      ? "border-rose-400 bg-rose-400"
                      : "border-slate-600 bg-transparent",
                  )}
                />
              </div>
              <p className="mt-1.5 text-[11px] text-slate-400">
                Deny access permanently
              </p>
            </button>
          </div>
        </div>

        {/* Approval Options: Plan & Features */}
        {selectedChoice === CLINIC_DECISIONS.APPROVE && status === "PENDING" && (
          <div className="space-y-4 pt-1 border-t border-slate-800/60">
            {!emailVerified && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-300 flex items-start gap-2">
                <AlertCircle className="h-4 w-4 shrink-0 text-amber-400 mt-0.5" />
                <span>
                  This applicant has not verified their email address yet. Approving
                  is still possible — they will be asked to verify before they can
                  sign in.
                </span>
              </div>
            )}

            <div>
              <Select
                id="planKey"
                label="Plan"
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

            <fieldset className="space-y-2">
              <legend className="text-xs font-semibold text-slate-300">
                Feature entitlements
              </legend>
              <p className="text-[11px] text-slate-500">
                Ticked follows the selected plan unless you change it. A change is
                stored as an override and needs a reason.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
                {features.map((feature) => {
                  const planDefault = planDefaults.get(feature.key) ?? false;
                  const enabled = isEnabled(feature);
                  const deviates = enabled !== planDefault;

                  return (
                    <label
                      key={feature.key}
                      className={cx(
                        "flex items-start gap-2.5 rounded-xl border p-2.5 text-xs transition-colors cursor-pointer",
                        enabled
                          ? "border-slate-700 bg-[#090e23]/80 text-white"
                          : "border-slate-800/80 bg-[#090e23]/40 text-slate-400",
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={enabled}
                        disabled={!feature.globalEnabled}
                        onChange={(event) =>
                          setOverrides((current) => ({
                            ...current,
                            [feature.key]: event.target.checked,
                          }))
                        }
                        className="mt-0.5 h-3.5 w-3.5 rounded border-slate-700 bg-slate-900 text-indigo-600 focus:ring-0 focus:ring-offset-0"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="font-semibold text-white block">
                          {feature.name}
                          {feature.tier !== "CORE" && (
                            <span className="ml-1.5 rounded border border-slate-700 bg-slate-800 px-1 py-0.2 text-[9px] text-slate-300 uppercase">
                              {feature.tier}
                            </span>
                          )}
                        </span>
                        <span className="text-[10px] text-slate-500 block mt-0.5">
                          {!feature.globalEnabled
                            ? "Disabled platform-wide"
                            : deviates
                              ? `Overrides plan (${planDefault ? "on" : "off"})`
                              : "Follows plan"}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>

            {needsEntitlementReason && (
              <div className="space-y-1.5">
                <label
                  htmlFor="entitlementReason"
                  className="block text-xs font-semibold text-slate-300"
                >
                  Why these features differ from the plan
                </label>
                <textarea
                  id="entitlementReason"
                  rows={2}
                  value={entitlementReason}
                  onChange={(event) => setEntitlementReason(event.target.value)}
                  placeholder="Explain the plan deviation..."
                  className="w-full rounded-xl border border-slate-800 bg-[#090e23]/80 px-3.5 py-2 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-indigo-500/50"
                />
              </div>
            )}
          </div>
        )}

        {/* Suspend Context Warning */}
        {selectedChoice === CLINIC_DECISIONS.SUSPEND && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-300 flex items-start gap-2">
            <Info className="h-4 w-4 shrink-0 text-amber-400 mt-0.5" />
            <span>
              Suspending removes access for everyone in this organisation on their
              next request, including sessions that are already open.
            </span>
          </div>
        )}

        {/* Reason Field with Character Count */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label htmlFor="reason" className="block text-xs font-semibold text-slate-300">
              Reason {isReasonRequired ? "(required)" : "(optional)"}
            </label>
            <span className="text-[11px] font-mono text-slate-500 tabular-nums">
              {reason.length}/{MAX_REASON_LENGTH}
            </span>
          </div>
          <textarea
            id="reason"
            rows={2}
            value={reason}
            maxLength={MAX_REASON_LENGTH}
            placeholder="Add a reason for your decision..."
            onChange={(event) => setReason(event.target.value)}
            className="w-full rounded-xl border border-slate-800 bg-[#090e23]/80 px-3.5 py-2.5 text-xs sm:text-sm text-white placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-indigo-500/50 transition-all resize-none"
          />
          {isReasonTooShort && (
            <p className="text-[11px] text-amber-400">
              Reason must be at least {MIN_REASON_LENGTH} characters.
            </p>
          )}
        </div>

        {/* Bottom Actions Row */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-800/60">
          <div className="flex flex-wrap items-center gap-2.5">
            {/* Primary Action Button */}
            {selectedChoice === CLINIC_DECISIONS.APPROVE && (
              <button
                type="button"
                disabled={isSubmitDisabled}
                onClick={() => submit(CLINIC_DECISIONS.APPROVE)}
                className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 via-indigo-500 to-purple-600 px-5 py-2.5 text-xs font-semibold text-white shadow-md shadow-indigo-600/25 hover:from-indigo-500 hover:to-purple-500 active:scale-[0.99] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <ShieldCheck className="h-4 w-4" />
                <span>
                  {pending === CLINIC_DECISIONS.APPROVE
                    ? "Approving…"
                    : "Approve application"}
                </span>
              </button>
            )}

            {selectedChoice === CLINIC_DECISIONS.REACTIVATE && (
              <button
                type="button"
                disabled={isSubmitDisabled}
                onClick={() => submit(CLINIC_DECISIONS.REACTIVATE)}
                className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-500 px-5 py-2.5 text-xs font-semibold text-white shadow-md shadow-emerald-600/25 hover:from-emerald-500 hover:to-emerald-400 active:scale-[0.99] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <RotateCcw className="h-4 w-4" />
                <span>
                  {pending === CLINIC_DECISIONS.REACTIVATE
                    ? "Reactivating…"
                    : "Reactivate organisation"}
                </span>
              </button>
            )}

            {selectedChoice === CLINIC_DECISIONS.SUSPEND && (
              <button
                type="button"
                disabled={isSubmitDisabled}
                onClick={() => submit(CLINIC_DECISIONS.SUSPEND)}
                className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-amber-600 to-amber-500 px-5 py-2.5 text-xs font-semibold text-white shadow-md shadow-amber-600/25 hover:from-amber-500 hover:to-amber-400 active:scale-[0.99] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <PauseCircle className="h-4 w-4" />
                <span>
                  {pending === CLINIC_DECISIONS.SUSPEND
                    ? "Suspending…"
                    : "Suspend application"}
                </span>
              </button>
            )}

            {selectedChoice === CLINIC_DECISIONS.REJECT && (
              <button
                type="button"
                disabled={isSubmitDisabled}
                onClick={() => submit(CLINIC_DECISIONS.REJECT)}
                className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-rose-600 to-rose-500 px-5 py-2.5 text-xs font-semibold text-white shadow-md shadow-rose-600/25 hover:from-rose-500 hover:to-rose-400 active:scale-[0.99] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <XCircle className="h-4 w-4" />
                <span>
                  {pending === CLINIC_DECISIONS.REJECT
                    ? "Rejecting…"
                    : "Reject application"}
                </span>
              </button>
            )}

            {/* Direct Shortcut Buttons matching reference */}
            {status === "ACTIVE" && selectedChoice !== CLINIC_DECISIONS.SUSPEND && (
              <button
                type="button"
                onClick={() => setSelectedChoice(CLINIC_DECISIONS.SUSPEND)}
                className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3.5 py-2 text-xs font-semibold text-amber-300 hover:bg-amber-500/20 transition-colors"
              >
                Suspend
              </button>
            )}

            {status === "PENDING" && selectedChoice !== CLINIC_DECISIONS.SUSPEND && (
              <button
                type="button"
                onClick={() => setSelectedChoice(CLINIC_DECISIONS.SUSPEND)}
                className="rounded-xl border border-slate-800 bg-[#090e23]/60 px-3.5 py-2 text-xs font-semibold text-amber-400/80 hover:border-amber-500/40 hover:text-amber-300 transition-colors"
              >
                Suspend
              </button>
            )}

            {status === "PENDING" && selectedChoice !== CLINIC_DECISIONS.REJECT && (
              <button
                type="button"
                onClick={() => setSelectedChoice(CLINIC_DECISIONS.REJECT)}
                className="rounded-xl border border-slate-800 bg-[#090e23]/60 px-3.5 py-2 text-xs font-semibold text-rose-400/80 hover:border-rose-500/40 hover:text-rose-300 transition-colors"
              >
                Reject
              </button>
            )}
          </div>

          {/* Cancel Button */}
          <button
            type="button"
            onClick={() => {
              setReason("");
              setEntitlementReason("");
              setError(null);
              setNotice(null);
            }}
            className="text-xs font-medium text-slate-400 hover:text-white transition-colors px-2 py-1"
          >
            Cancel
          </button>
        </div>
      </section>

      {/* Informational Footer Panel */}
      <div className="rounded-2xl border border-slate-800/80 bg-[#0d1427]/60 p-4 shadow-sm flex items-start gap-3">
        <Info className="h-4 w-4 text-indigo-400 shrink-0 mt-0.5" />
        <div className="text-xs text-slate-400 leading-relaxed">
          Approving this application will activate the clinic and grant them access to the platform.
        </div>
      </div>
    </div>
  );
}
