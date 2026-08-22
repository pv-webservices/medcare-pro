"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Power, PowerOff } from "lucide-react";
import type { PlatformFeatureRow } from "@/lib/platform/entitlements";
import { MIN_REASON_LENGTH } from "@/lib/platform/entitlementPolicy";

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
  CORE: "border-slate-700 text-slate-400",
  PREMIUM: "border-emerald-500/40 text-emerald-300",
  BETA: "border-amber-500/40 text-amber-300",
  INTERNAL: "border-rose-500/40 text-rose-300",
};

const GENERIC_ERROR = "Could not change that switch. Try again.";

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
    <div className="space-y-3">
      {error && (
        <p
          role="alert"
          className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200"
        >
          {error}
        </p>
      )}
      {notice && (
        <p
          role="status"
          className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-200"
        >
          {notice}
        </p>
      )}

      {features.map((feature) => {
        const isOpen = openKey === feature.key;
        const switchingOff = feature.globalEnabled;
        const confirmed = !switchingOff || confirmation.trim() === feature.key;
        const reasonLongEnough = reason.trim().length >= MIN_REASON_LENGTH;

        return (
          <section
            key={feature.key}
            className="rounded-xl border border-slate-800 bg-slate-900 p-5"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-sm font-semibold text-slate-100">
                    {feature.name}
                  </h2>
                  <code className="rounded bg-slate-950 px-1.5 py-0.5 text-[11px] text-slate-400">
                    {feature.key}
                  </code>
                  <span
                    className={`rounded border px-1.5 py-0.5 text-[10px] ${
                      TIER_STYLES[feature.tier] ?? TIER_STYLES.CORE
                    }`}
                  >
                    {feature.tier}
                  </span>
                  <span
                    className={`rounded-md border px-2 py-0.5 text-[11px] font-medium ${
                      feature.globalEnabled
                        ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                        : "border-rose-500/30 bg-rose-500/10 text-rose-300"
                    }`}
                  >
                    {feature.globalEnabled ? "Live" : "Switched off"}
                  </span>
                </div>

                {feature.description && (
                  <p className="mt-1.5 text-xs text-slate-400">
                    {feature.description}
                  </p>
                )}

                <p className="mt-2 text-xs text-slate-400">
                  <span className="tabular-nums text-slate-200">
                    {feature.entitledTenants}
                  </span>{" "}
                  of {totalCustomerTenants} organisation
                  {totalCustomerTenants === 1 ? "" : "s"} entitled
                  {feature.plansIncluding.length > 0
                    ? ` · in ${feature.plansIncluding.join(", ")}`
                    : " · in no plan"}
                  {feature.overridesGranted + feature.overridesRevoked > 0 &&
                    ` · ${feature.overridesGranted} granted and ${feature.overridesRevoked} revoked by override`}
                </p>

                {!feature.isEnforced && (
                  <p className="mt-2 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-2.5 text-[11px] text-amber-200">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>
                      Nothing checks this key, so switching it changes nothing
                      today. {feature.enforcementNote}
                    </span>
                  </p>
                )}

                {feature.lastChange.at && (
                  <p className="mt-2 text-[11px] text-slate-500">
                    Last changed {feature.lastChange.at.toISOString().slice(0, 10)}
                    {feature.lastChange.byName
                      ? ` by ${feature.lastChange.byName}`
                      : ""}
                    {feature.lastChange.reason
                      ? ` — “${feature.lastChange.reason}”`
                      : ""}
                  </p>
                )}
              </div>

              {!isOpen && (
                <button
                  type="button"
                  onClick={() => open(feature.key)}
                  className={`inline-flex shrink-0 items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold transition ${
                    feature.globalEnabled
                      ? "border-rose-500/40 bg-rose-500/10 text-rose-200 hover:bg-rose-500/20"
                      : "border-emerald-500/40 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20"
                  }`}
                >
                  {feature.globalEnabled ? (
                    <>
                      <PowerOff className="h-3.5 w-3.5" />
                      Switch off platform-wide
                    </>
                  ) : (
                    <>
                      <Power className="h-3.5 w-3.5" />
                      Switch back on
                    </>
                  )}
                </button>
              )}
            </div>

            {isOpen && (
              <div className="mt-4 rounded-lg border border-slate-700 bg-slate-950 p-4">
                {switchingOff && (
                  <p className="flex items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-500/5 p-3 text-xs text-rose-200">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>
                      This removes {feature.name} from{" "}
                      <span className="font-semibold tabular-nums">
                        {feature.entitledTenants}
                      </span>{" "}
                      organisation{feature.entitledTenants === 1 ? "" : "s"} the
                      moment it saves. No plan, override or role can reach past
                      it, and nobody in those organisations can restore it
                      themselves.
                    </span>
                  </p>
                )}

                <label
                  htmlFor={`reason-${feature.key}`}
                  className="mt-4 block text-xs font-medium text-slate-300"
                >
                  Reason (required, at least {MIN_REASON_LENGTH} characters)
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
                  className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:border-slate-500 focus:outline-none"
                />

                {switchingOff && (
                  <>
                    <label
                      htmlFor={`confirm-${feature.key}`}
                      className="mt-4 block text-xs font-medium text-slate-300"
                    >
                      Type <code className="text-slate-100">{feature.key}</code>{" "}
                      to confirm
                    </label>
                    <input
                      id={`confirm-${feature.key}`}
                      type="text"
                      autoComplete="off"
                      value={confirmation}
                      onChange={(event) => setConfirmation(event.target.value)}
                      className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-sm text-slate-100 focus:border-slate-500 focus:outline-none"
                    />
                  </>
                )}

                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={pending || !confirmed || !reasonLongEnough}
                    onClick={() => submit(feature)}
                    className="rounded-lg bg-slate-100 px-4 py-2 text-xs font-semibold text-slate-900 transition hover:bg-white disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
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
                    className="rounded-lg border border-slate-700 px-4 py-2 text-xs font-medium text-slate-300 transition hover:border-slate-500 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
