"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Lock, ShieldCheck } from "lucide-react";
import Card from "@/components/ui/Card";
import StatusPill from "@/components/ui/StatusPill";
import { useToast } from "@/components/ui/Toast";
import type { FeatureOverviewRow, RoleFeatureRow } from "@/lib/features";

/**
 * Which roles may use which of the organisation's features — Stage 8, layer 3.
 *
 * ONE SWITCH PER (ROLE x FEATURE), and a tri-state underneath it: on, off, or
 * no opinion. The screen shows two columns rather than one, because "inherit"
 * and "on" look identical to a user until the day the organisation's
 * entitlement changes and only one of them follows it.
 *
 * WHAT IS NOT EDITABLE, AND WHY EACH SAYS SO ON SCREEN:
 *
 *   - a feature the organisation does not hold — the switch would resolve to a
 *     denial whatever it said, so it is shown locked with the reason;
 *   - the account owner's role — layer 3 cannot touch a wildcard holder, and a
 *     switch that silently does nothing is worse than no switch;
 *   - an always-available feature — nothing checks the key, so the switch would
 *     be decorative.
 *
 * The server refuses all three independently (setRoleFeatureAccess). Disabling
 * them here is the courtesy layer, never the control.
 */

interface FeatureMatrixProps {
  features: readonly FeatureOverviewRow[];
  canManage: boolean;
}

const TIER_TONE = {
  CORE: "neutral",
  PREMIUM: "ok",
  BETA: "warn",
  INTERNAL: "alert",
} as const;

/** The stored tri-state, as a control value. */
type AccessValue = "inherit" | "on" | "off";

function toValue(access: boolean | null): AccessValue {
  return access === null ? "inherit" : access ? "on" : "off";
}

function fromValue(value: AccessValue): boolean | null {
  return value === "inherit" ? null : value === "on";
}

export default function FeatureMatrix({ features, canManage }: FeatureMatrixProps) {
  const router = useRouter();
  const showToast = useToast();
  const [busyKey, setBusyKey] = useState<string | null>(null);

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
      {features.map((feature) => (
        <Card key={feature.key}>
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-section font-semibold text-ink">{feature.name}</h3>
                <StatusPill tone={TIER_TONE[feature.tier]}>
                  {feature.tier.toLowerCase()}
                </StatusPill>
                {feature.isEntitled ? (
                  <StatusPill tone="ok">Included</StatusPill>
                ) : (
                  <StatusPill tone="alert">Not included</StatusPill>
                )}
              </div>
              {feature.description && (
                <p className="mt-1 text-body text-muted">{feature.description}</p>
              )}
              <p className="mt-1 text-body text-muted">
                {featureNote(feature)}
              </p>
            </div>
          </div>

          {feature.isEntitled && !feature.isUngated ? (
            <ul className="divide-y divide-line border-t border-line">
              {feature.roles.map((role) => {
                const key = `${feature.key}:${role.roleId}`;
                const id = `feature-${key}`;

                return (
                  <li
                    key={role.roleId}
                    className="flex flex-wrap items-center justify-between gap-3 py-3"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="text-body font-medium text-ink">
                        {role.roleName}
                      </span>
                      {role.isAccountOwner && (
                        <span className="inline-flex items-center gap-1 text-meta font-medium text-muted">
                          <ShieldCheck
                            aria-hidden="true"
                            strokeWidth={1.75}
                            className="h-4 w-4"
                          />
                          Account owner — always on
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-3">
                      <StatusPill tone={role.isEffective ? "ok" : "neutral"}>
                        {role.isEffective ? "Can use" : "Cannot use"}
                      </StatusPill>

                      <label htmlFor={id} className="sr-only">
                        {feature.name} for {role.roleName}
                      </label>
                      <select
                        id={id}
                        value={toValue(role.access)}
                        disabled={!role.isEditable || busyKey === key}
                        onChange={(event) =>
                          handleChange(feature, role, event.target.value as AccessValue)
                        }
                        className="min-h-9 rounded-xl border border-line bg-canvas px-3 text-body text-ink disabled:bg-canvas-deep disabled:text-faint"
                      >
                        {/* Named for what it does, not for the null it stores. */}
                        <option value="inherit">
                          Follow the organisation
                          {feature.inheritsWhenSilent ? "(on)" : "(off)"}
                        </option>
                        <option value="on">On for this role</option>
                        <option value="off">Off for this role</option>
                      </select>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="flex items-start gap-2 rounded-2xl border border-line bg-canvas-deep px-4 py-3 text-body text-muted">
              <Lock
                aria-hidden="true"
                strokeWidth={1.75}
                className="mt-0.5 h-4 w-4 shrink-0"
              />
              <span>
                {feature.isUngated
                  ? feature.ungatedNote
                  : "Your organisation does not have this feature, so it cannot be given to a role. Contact MEDCARE PRO to add it."}
              </span>
            </p>
          )}

          {!canManage && feature.isEntitled && !feature.isUngated && (
            <p className="mt-3 text-body text-muted">
              You can see these settings but not change them.
            </p>
          )}
        </Card>
      ))}
    </div>
  );
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
  }
}
