"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw } from "lucide-react";
import type { TenantEntitlementView } from "@/lib/platform/entitlements";
import { MIN_REASON_LENGTH } from "@/lib/platform/entitlementPolicy";

/**
 * One organisation's plan and overrides — Stage 9, layer 2b.
 *
 * The standalone counterpart to the entitlement half of the Stage 3 decision
 * screen, for an organisation that is already past its decision. It shares that
 * screen's model exactly: ticks are held as a sparse map of DEVIATIONS from the
 * selected plan rather than a full copy of the state, so switching plan
 * re-evaluates every row the Owner has not personally touched. A full copy would
 * silently pin nine overrides the moment someone changed the plan dropdown.
 *
 * Three rules, all of them enforced again server-side:
 *   - a tick that agrees with the plan CLEARS any override rather than pinning
 *     it, so the organisation keeps tracking its plan;
 *   - a tick that disagrees writes an override and needs a reason;
 *   - a feature switched off platform-wide cannot be granted here at all.
 */

interface TenantEntitlementsPanelProps {
  view: TenantEntitlementView;
}

const GENERIC_ERROR = "Could not save those entitlements. Try again.";

export default function TenantEntitlementsPanel({
  view,
}: TenantEntitlementsPanelProps) {
  const router = useRouter();

  const selectablePlans = view.plans.filter(
    (plan) => plan.isActive || plan.key === view.planKey,
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
    (feature) =>
      // A deviation only needs a reason if it is not ALREADY the stored
      // override — re-saving an unchanged screen must not demand a fresh one.
      feature.override !== isEnabled(feature.key),
  );
  const reasonLongEnough = reason.trim().length >= MIN_REASON_LENGTH;
  const dirty =
    planChanged ||
    view.features.some((feature) => {
      const enabled = isEnabled(feature.key);
      const agreesWithPlan = enabled === planDefaults.has(feature.key);
      return agreesWithPlan ? feature.override !== null : feature.override !== enabled;
    });

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
    <section className="rounded-3xl bg-canvas p-5 shadow-neu-raised-sm">
      <h2 className="text-sm font-semibold text-ink">Plan and entitlements</h2>
      <p className="mt-1 text-xs text-faint">
        Layers 1 and 2 of four. What each role in the organisation may then use is
        the organisation admin&rsquo;s own setting, and nothing here changes it.
      </p>

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
          className="mt-3 rounded-lg bg-ok-bg p-3 text-sm text-ok-ink"
        >
          {notice}
        </p>
      )}

      <div className="mt-4">
        <label htmlFor="tenantPlan" className="block text-xs font-medium text-muted">
          Plan
        </label>
        <select
          id="tenantPlan"
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
        {planChanged && (
          <p className="mt-1.5 text-[11px] text-warn-ink">
            Changing the plan re-evaluates every feature you have not ticked
            yourself.
          </p>
        )}
      </div>

      <fieldset className="mt-5">
        <legend className="text-xs font-medium text-muted">Features</legend>
        <p className="mt-1 text-[11px] text-faint">
          A tick that matches the plan clears any override, so the organisation
          keeps following the plan when it changes. A tick that differs is stored
          as an override and needs a reason.
        </p>

        <div className="mt-3 space-y-2">
          {view.features.map((feature) => {
            const planGrants = planDefaults.has(feature.key);
            const enabled = isEnabled(feature.key);
            const deviates = enabled !== planGrants;

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
                    setTicks((current) => ({
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
                    {!feature.isEnforced && (
                      <span className="ml-2 text-[10px] text-faint">
                        not enforced
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 block text-[11px] text-faint">
                    {!feature.globalEnabled
                      ? "Switched off platform-wide — no plan or override can grant it."
                      : deviates
                        ? `Overrides the plan (plan says ${planGrants ? "on" : "off"})`
                        : "Follows the plan"}
                  </span>
                  {feature.override !== null && feature.overrideReason && (
                    <span className="mt-0.5 block text-[11px] text-faint">
                      Current override: “{feature.overrideReason}”
                    </span>
                  )}
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <label htmlFor="entitlementReason" className="mt-5 block text-xs font-medium text-muted">
        Reason{""}
        {needsReason
          ? `(required, at least ${MIN_REASON_LENGTH} characters)`
          : "(optional)"}
      </label>
      <textarea
        id="entitlementReason"
        rows={2}
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        placeholder="e.g. Pilot customer — WhatsApp enabled ahead of their plan"
        className="mt-1.5 w-full rounded-2xl bg-canvas px-3 py-2 text-sm text-ink placeholder:text-faint shadow-neu-inset"
      />

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={pending || !dirty || (needsReason && !reasonLongEnough)}
          onClick={submit}
          className="rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-accent-ink transition hover:bg-accent-strong disabled:cursor-not-allowed disabled:bg-canvas-deep disabled:text-muted"
        >
          {pending ? "Saving…" : "Save entitlements"}
        </button>
        <button
          type="button"
          disabled={pending || (Object.keys(ticks).length === 0 && !planChanged)}
          onClick={() => {
            setTicks({});
            setPlanKey(view.planKey ?? selectablePlans[0]?.key ?? "");
            setReason("");
          }}
          className="inline-flex items-center gap-1.5 rounded-lg border border-line px-4 py-2 text-xs font-medium text-muted transition hover:border-line disabled:opacity-50"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Discard changes
        </button>
      </div>
    </section>
  );
}
