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
  CORE: "border-line text-muted",
  PREMIUM: "border-line text-ok-ink",
  BETA: "border-line text-warn-ink",
  INTERNAL: "border-line text-alert-ink",
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

      {features.map((feature) => {
        const isOpen = openKey === feature.key;
        const switchingOff = feature.globalEnabled;
        const confirmed = !switchingOff || confirmation.trim() === feature.key;
        const reasonLongEnough = reason.trim().length >= MIN_REASON_LENGTH;

        return (
          <section
            key={feature.key}
            className="rounded-3xl bg-canvas p-5 shadow-neu-raised-sm"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-sm font-semibold text-ink">
                    {feature.name}
                  </h2>
                  <code className="rounded bg-canvas px-1.5 py-0.5 text-[11px] text-muted">
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
                        ? "border-line bg-ok-bg text-ok-ink"
                        : "border-line bg-alert-bg text-alert-ink"
                    }`}
                  >
                    {feature.globalEnabled ? "Live" : "Switched off"}
                  </span>
                </div>

                {feature.description && (
                  <p className="mt-1.5 text-xs text-muted">
                    {feature.description}
                  </p>
                )}

                <p className="mt-2 text-xs text-muted">
                  <span className="tabular-nums text-ink">
                    {feature.entitledTenants}
                  </span>{""}
                  of {totalCustomerTenants} organisation
                  {totalCustomerTenants === 1 ? "" : "s"} entitled
                  {feature.plansIncluding.length > 0
                    ? ` · in ${feature.plansIncluding.join(",")}`
                    : "· in no plan"}
                  {feature.overridesGranted + feature.overridesRevoked > 0 &&
                    ` · ${feature.overridesGranted} granted and ${feature.overridesRevoked} revoked by override`}
                </p>

                {!feature.isEnforced && (
                  <p className="mt-2 flex items-start gap-2 rounded-lg bg-warn-bg p-2.5 text-[11px] text-warn-ink">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>
                      Nothing checks this key, so switching it changes nothing
                      today. {feature.enforcementNote}
                    </span>
                  </p>
                )}

                {feature.lastChange.at && (
                  <p className="mt-2 text-[11px] text-faint">
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
                      ? "border-line bg-alert-bg text-alert-ink hover:bg-alert-bg"
                      : "border-line bg-ok-bg text-ok-ink hover:bg-ok-bg"
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
              <div className="mt-4 rounded-2xl bg-canvas p-4 shadow-neu-raised-sm">
                {switchingOff && (
                  <p className="flex items-start gap-2 rounded-lg bg-alert-bg p-3 text-xs text-alert-ink">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>
                      This removes {feature.name} from{""}
                      <span className="font-semibold tabular-nums">
                        {feature.entitledTenants}
                      </span>{""}
                      organisation{feature.entitledTenants === 1 ? "" : "s"} the
                      moment it saves. No plan, override or role can reach past
                      it, and nobody in those organisations can restore it
                      themselves.
                    </span>
                  </p>
                )}

                <label
                  htmlFor={`reason-${feature.key}`}
                  className="mt-4 block text-xs font-medium text-muted"
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
                  className="mt-1.5 w-full rounded-2xl bg-canvas px-3 py-2 text-sm text-ink placeholder:text-faint shadow-neu-inset"
                />

                {switchingOff && (
                  <>
                    <label
                      htmlFor={`confirm-${feature.key}`}
                      className="mt-4 block text-xs font-medium text-muted"
                    >
                      Type <code className="text-ink">{feature.key}</code>{""}
                      to confirm
                    </label>
                    <input
                      id={`confirm-${feature.key}`}
                      type="text"
                      autoComplete="off"
                      value={confirmation}
                      onChange={(event) => setConfirmation(event.target.value)}
                      className="mt-1.5 w-full rounded-2xl bg-canvas px-3 py-2 font-mono text-sm text-ink shadow-neu-inset"
                    />
                  </>
                )}

                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={pending || !confirmed || !reasonLongEnough}
                    onClick={() => submit(feature)}
                    className="rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-accent-ink transition hover:bg-accent-strong disabled:cursor-not-allowed disabled:bg-canvas-deep disabled:text-muted"
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
                    className="rounded-lg border border-line px-4 py-2 text-xs font-medium text-muted transition hover:border-line disabled:opacity-50"
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
