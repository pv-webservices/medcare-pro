"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import type { PlanAdminRow } from "@/lib/platform/entitlements";
import { MIN_REASON_LENGTH } from "@/lib/platform/entitlementPolicy";

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
      {error && (
        <p
          role="alert"
          className="rounded-lg bg-alert-bg p-3 text-sm text-alert-ink"
        >
          {error}
        </p>
      )}
      {notice && (
        <p
          role="status"
          className="rounded-lg bg-ok-bg p-3 text-sm text-ok-ink"
        >
          {notice}
        </p>
      )}

      {plans.length === 0 && (
        <p className="rounded-3xl bg-canvas p-5 text-sm text-muted shadow-neu-raised-sm">
          No plans exist yet. Run the seed to create the standard plan.
        </p>
      )}

      {plans.map((plan) => (
        <section
          key={plan.key}
          className="rounded-3xl bg-canvas p-5 shadow-neu-raised-sm"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold text-ink">
              {plan.name}
              {!plan.isActive && (
                <span className="ml-2 rounded border border-line px-1.5 py-0.5 text-[10px] font-normal text-muted">
                  retired
                </span>
              )}
            </h2>
            <p className="text-xs text-muted">
              <span className="tabular-nums text-ink">
                {plan.tenantCount}
              </span>{""}
              organisation{plan.tenantCount === 1 ? "" : "s"} on this plan
            </p>
          </div>

          {plan.description && (
            <p className="mt-1 text-xs text-faint">{plan.description}</p>
          )}

          <ul className="mt-4 divide-y divide-line border-t border-line">
            {plan.features.map((feature) => {
              const isTarget =
                change?.planKey === plan.key && change.featureKey === feature.key;

              return (
                <li key={feature.key} className="py-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <span className="text-sm text-ink">{feature.name}</span>
                      <code className="ml-2 rounded bg-canvas px-1.5 py-0.5 text-[11px] text-faint">
                        {feature.key}
                      </code>
                      {!feature.globalEnabled && (
                        <span className="ml-2 text-[11px] text-alert-ink">
                          off platform-wide
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-3">
                      <span
                        className={`rounded-md border px-2 py-0.5 text-[11px] font-medium ${
                          feature.included
                            ? "border-line bg-ok-bg text-ok-ink"
                            : "border-line text-muted"
                        }`}
                      >
                        {feature.included ? "Included" : "Not included"}
                      </span>
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() =>
                          begin({
                            planKey: plan.key,
                            featureKey: feature.key,
                            featureName: feature.name,
                            included: !feature.included,
                            tenantCount: plan.tenantCount,
                          })
                        }
                        className="rounded-lg border border-line px-3 py-1.5 text-[11px] font-medium text-muted transition hover:border-line disabled:opacity-50"
                      >
                        {feature.included ? "Remove from plan" : "Add to plan"}
                      </button>
                    </div>
                  </div>

                  {isTarget && (
                    <div className="mt-3 rounded-2xl bg-canvas p-4 shadow-neu-raised-sm">
                      {isRemoval ? (
                        <p className="flex items-start gap-2 text-xs text-warn-ink">
                          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                          <span>
                            Removing {feature.name} takes it from every
                            organisation on {plan.name} that has no override of
                            its own — up to{""}
                            <span className="font-semibold tabular-nums">
                              {plan.tenantCount}
                            </span>
                            . Their per-role settings are left alone, so
                            restoring the feature restores their choices with it.
                          </span>
                        </p>
                      ) : (
                        <p className="text-xs text-muted">
                          Adding {feature.name} grants it to every organisation
                          on {plan.name} that has no override of its own.
                          {feature.tier !== "CORE" &&
                            "Because this is not a CORE feature, each organisation's admin still has to switch it on per role."}
                        </p>
                      )}

                      <label
                        htmlFor={`plan-reason-${plan.key}-${feature.key}`}
                        className="mt-4 block text-xs font-medium text-muted"
                      >
                        Reason{""}
                        {isRemoval
                          ? `(required, at least ${MIN_REASON_LENGTH} characters)`
                          : "(optional)"}
                      </label>
                      <textarea
                        id={`plan-reason-${plan.key}-${feature.key}`}
                        rows={2}
                        value={reason}
                        onChange={(event) => setReason(event.target.value)}
                        className="mt-1.5 w-full rounded-2xl bg-canvas px-3 py-2 text-sm text-ink shadow-neu-inset"
                      />

                      <div className="mt-4 flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={pending || (isRemoval && !reasonLongEnough)}
                          onClick={submit}
                          className="rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-accent-ink transition hover:bg-accent-strong disabled:cursor-not-allowed disabled:bg-canvas-deep disabled:text-muted"
                        >
                          {pending
                            ? "Saving…"
                            : isRemoval
                              ? "Remove from plan"
                              : "Add to plan"}
                        </button>
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => setChange(null)}
                          className="rounded-lg border border-line px-4 py-2 text-xs font-medium text-muted transition hover:border-line disabled:opacity-50"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
