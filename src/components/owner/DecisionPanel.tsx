"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  FeatureEntitlementView,
  PlanOption,
} from "@/lib/platform/applications";
import {
  CLINIC_DECISIONS,
  MIN_REASON_LENGTH,
  type ClinicDecision,
} from "@/lib/platform/decisionPolicy";
import type { TenantStatus } from "@prisma/client";

/**
 * The Owner's decision controls — Stage 3 items 6 to 9.
 *
 * A convenience layer over the API and nothing more. Every rule it enforces —
 * which decisions a status allows, that a rejection needs a reason, that an
 * off-plan feature needs one too — is enforced again server-side in
 * src/lib/platform/decisionPolicy.ts, which is the copy that counts. Disabling a
 * button here stops a mistake; it does not stop an attacker, and is not relied
 * on to.
 */

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

  const selectablePlans = plans.filter(
    (plan) => plan.isActive || plan.key === currentPlanKey,
  );

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

  /**
   * A feature is on if the Owner has ticked it this session; otherwise it falls
   * back to the tenant's existing override, and then to the selected plan. Held
   * as a sparse map of deviations rather than a full copy, so switching plan
   * updates every untouched row automatically.
   */
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

  const reasonTooShort =
    reason.trim().length > 0 && reason.trim().length < MIN_REASON_LENGTH;

  if (status === "REJECTED" || status === "ARCHIVED") {
    return (
      <p className="mt-8 rounded-3xl bg-canvas p-5 text-sm text-muted shadow-neu-raised-sm">
        This application is closed. Re-admitting a rejected applicant is a fresh
        registration, not a status change.
      </p>
    );
  }

  return (
    <section className="mt-8 rounded-3xl bg-canvas p-5 shadow-neu-raised-sm">
      <h2 className="text-sm font-semibold text-ink">Decision</h2>

      {error && (
        <p
          role="alert"
          className="mt-3 rounded-lg bg-alert-bg p-3 text-sm text-alert-ink"
        >
          {error}
        </p>
      )}
      {notice && (
        <p
          role="status"
          className="mt-3 rounded-lg bg-warn-bg p-3 text-sm text-warn-ink"
        >
          {notice}
        </p>
      )}

      {status === "PENDING" && (
        <>
          {!emailVerified && (
            <p className="mt-3 rounded-lg bg-warn-bg p-3 text-xs text-warn-ink">
              This applicant has not verified their email address yet. Approving
              is still possible — they will be asked to verify before they can
              sign in.
            </p>
          )}

          <div className="mt-4">
            <label
              htmlFor="planKey"
              className="block text-xs font-medium text-muted"
            >
              Plan
            </label>
            <select
              id="planKey"
              value={planKey}
              onChange={(event) => setPlanKey(event.target.value)}
              className="mt-1.5 w-full rounded-2xl bg-canvas px-3 py-2 text-sm text-ink shadow-neu-inset"
            >
              {selectablePlans.length === 0 && <option value="">No plans</option>}
              {selectablePlans.map((plan) => (
                <option key={plan.key} value={plan.key}>
                  {plan.name}
                  {plan.isActive ? "" : "(retired)"}
                </option>
              ))}
            </select>
          </div>

          <fieldset className="mt-5">
            <legend className="text-xs font-medium text-muted">
              Feature entitlements
            </legend>
            <p className="mt-1 text-[11px] text-faint">
              Ticked follows the selected plan unless you change it. A change is
              stored as an override and needs a reason.
            </p>
            <div className="mt-3 space-y-2">
              {features.map((feature) => {
                const planDefault = planDefaults.get(feature.key) ?? false;
                const enabled = isEnabled(feature);
                const deviates = enabled !== planDefault;

                return (
                  <label
                    key={feature.key}
                    className="flex items-start gap-3 rounded-2xl bg-canvas px-3 py-2 shadow-neu-raised-sm"
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
                      className="mt-0.5 h-4 w-4 rounded-2xl bg-canvas shadow-neu-inset"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm text-ink">
                        {feature.name}
                        {feature.tier !== "CORE" && (
                          <span className="ml-2 rounded border border-line px-1.5 py-0.5 text-[10px] text-muted">
                            {feature.tier}
                          </span>
                        )}
                      </span>
                      <span className="mt-0.5 block text-[11px] text-faint">
                        {!feature.globalEnabled
                          ? "Disabled platform-wide — no plan can grant it."
                          : deviates
                            ? `Overrides the plan (plan says ${planDefault ? "on" : "off"})`
                            : "Follows the plan"}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          {needsEntitlementReason && (
            <div className="mt-4">
              <label
                htmlFor="entitlementReason"
                className="block text-xs font-medium text-muted"
              >
                Why these features differ from the plan
              </label>
              <textarea
                id="entitlementReason"
                rows={2}
                value={entitlementReason}
                onChange={(event) => setEntitlementReason(event.target.value)}
                className="mt-1.5 w-full rounded-2xl bg-canvas px-3 py-2 text-sm text-ink shadow-neu-inset"
              />
            </div>
          )}

          <div className="mt-5">
            <label htmlFor="reason" className="block text-xs font-medium text-muted">
              Reason (required to reject)
            </label>
            <textarea
              id="reason"
              rows={2}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              className="mt-1.5 w-full rounded-2xl bg-canvas px-3 py-2 text-sm text-ink shadow-neu-inset"
            />
            {reasonTooShort && (
              <p className="mt-1 text-[11px] text-warn-ink">
                At least {MIN_REASON_LENGTH} characters.
              </p>
            )}
          </div>

          <div className="mt-5 flex flex-wrap gap-3">
            <button
              type="button"
              disabled={
                pending !== null ||
                planKey === "" ||
                (needsEntitlementReason &&
                  entitlementReason.trim().length < MIN_REASON_LENGTH)
              }
              onClick={() => submit(CLINIC_DECISIONS.APPROVE)}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-ink transition hover:bg-accent-strong disabled:opacity-50"
            >
              {pending === CLINIC_DECISIONS.APPROVE ? "Approving…" : "Approve"}
            </button>
            <button
              type="button"
              disabled={pending !== null || reason.trim().length < MIN_REASON_LENGTH}
              onClick={() => submit(CLINIC_DECISIONS.REJECT)}
              className="rounded-lg px-4 py-2 text-sm font-semibold text-alert-ink transition hover:bg-alert-bg disabled:opacity-50"
            >
              {pending === CLINIC_DECISIONS.REJECT ? "Rejecting…" : "Reject"}
            </button>
          </div>
        </>
      )}

      {status === "ACTIVE" && (
        <>
          <p className="mt-3 text-xs text-muted">
            Suspending removes access for everyone in this organisation on their
            next request, including sessions that are already open.
          </p>
          <label
            htmlFor="suspendReason"
            className="mt-4 block text-xs font-medium text-muted"
          >
            Reason (required)
          </label>
          <textarea
            id="suspendReason"
            rows={2}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            className="mt-1.5 w-full rounded-2xl bg-canvas px-3 py-2 text-sm text-ink shadow-neu-inset"
          />
          <button
            type="button"
            disabled={pending !== null || reason.trim().length < MIN_REASON_LENGTH}
            onClick={() => submit(CLINIC_DECISIONS.SUSPEND)}
            className="mt-4 rounded-lg border border-orange-500/40 px-4 py-2 text-sm font-semibold text-orange-300 transition hover:bg-orange-500/10 disabled:opacity-50"
          >
            {pending === CLINIC_DECISIONS.SUSPEND ? "Suspending…" : "Suspend"}
          </button>
        </>
      )}

      {status === "SUSPENDED" && (
        <>
          <p className="mt-3 text-xs text-muted">
            Reactivating restores access for everyone in this organisation.
          </p>
          <button
            type="button"
            disabled={pending !== null}
            onClick={() => submit(CLINIC_DECISIONS.REACTIVATE)}
            className="mt-4 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-ink transition hover:bg-accent-strong disabled:opacity-50"
          >
            {pending === CLINIC_DECISIONS.REACTIVATE
              ? "Reactivating…"
              : "Reactivate"}
          </button>
        </>
      )}
    </section>
  );
}
