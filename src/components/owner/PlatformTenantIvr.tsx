"use client";

import { useState } from "react";
import { ConfirmDialog } from "@/components/ui/Modal";
import type { PlatformTenantIvrView } from "@/lib/platform/plivoNumbers";

function formatNumber(value: string): string {
  return /^\+91\d{10}$/.test(value)
    ? `${value.slice(0, 3)} ${value.slice(3, 5)} ${value.slice(5, 9)} ${value.slice(9)}`
    : value;
}

function formatDate(value: string | null): string {
  if (!value) return "Not recorded";
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  }).format(new Date(value));
}

function formatActivity(value: string | null): string {
  return value ? formatDate(value) : "No recent calls";
}

function providerLabel(health: string): string {
  if (health === "HEALTHY") return "Healthy";
  if (health === "OUT_OF_SYNC") return "Wrong application";
  return "Missing from Plivo";
}

interface PendingAction {
  key: string;
  input: Record<string, unknown>;
  title: string;
  body: string;
  confirmLabel: string;
  successMessage: string;
}

export default function PlatformTenantIvr({ initialModel }: { initialModel: PlatformTenantIvrView }) {
  const [model, setModel] = useState(initialModel);
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [moveTargets, setMoveTargets] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingAction | null>(null);

  async function mutate(key: string, input: Record<string, unknown>, successMessage = "IVR number assignment updated.") {
    setBusy(key);
    setMessage(null);
    try {
      const response = await fetch(`/api/owner/applications/${encodeURIComponent(model.tenant.id)}/ivr`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const payload = await response.json();
      if (!response.ok || !payload.success) throw new Error(payload.error ?? "The assignment could not be changed.");
      setModel(payload.data);
      setSelections({});
      setMoveTargets({});
      setMessage(successMessage);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The assignment could not be changed.");
    } finally {
      setBusy(null);
    }
  }

  async function confirmPending() {
    if (!pending) return;
    await mutate(pending.key, pending.input, pending.successMessage);
    setPending(null);
  }

  return (
    <section className="space-y-4">
      {message && <p role="status" className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-sm text-slate-200">{message}</p>}
      <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-[#0d1427]">
        <table className="w-full min-w-[1180px] text-left text-sm">
          <thead className="border-b border-slate-800 text-xs uppercase tracking-wide text-slate-500">
            <tr>{["Clinic", "Current IVR number", "Provider", "Assignment", "Telephony", "Last activity", "Platform actions"].map((heading) => <th key={heading} className="px-4 py-3">{heading}</th>)}</tr>
          </thead>
          <tbody>
            {model.clinics.map((clinic) => {
              const assignment = clinic.assignment;
              const recoverable = clinic.recoverableQuarantine;
              const selected = selections[clinic.id] ?? "";
              const selectedNumber = model.availableNumbers.find((item) => item.id === selected);
              const moveTarget = moveTargets[clinic.id] ?? "";
              const destination = model.clinics.find((target) => target.id === moveTarget);
              const visibleNumber = assignment ?? recoverable;
              return (
                <tr key={clinic.id} className="border-b border-slate-800/70 align-top last:border-0">
                  <td className="px-4 py-4 font-semibold text-white">{clinic.name}</td>
                  <td className="px-4 py-4">
                    <p className="font-mono text-slate-200">{assignment ? formatNumber(assignment.phoneNumber) : "No active number"}</p>
                    {recoverable && (
                      <div className="mt-2 space-y-1 text-xs text-amber-300">
                        <p>Recently unassigned: <span className="font-mono">{formatNumber(recoverable.phoneNumber)}</span></p>
                        <p>Available again: {formatDate(recoverable.quarantinedUntil)}</p>
                      </div>
                    )}
                  </td>
                  <td className={`px-4 py-4 font-medium ${visibleNumber?.healthStatus === "HEALTHY" ? "text-emerald-400" : visibleNumber ? "text-amber-400" : "text-slate-500"}`}>{visibleNumber ? providerLabel(visibleNumber.healthStatus) : "Not set"}</td>
                  <td className="px-4 py-4 text-slate-300">{assignment ? "Assigned" : recoverable ? "Quarantined" : "Not set"}</td>
                  <td className={`px-4 py-4 ${assignment?.telephonyEnabled ? "text-emerald-400" : "text-slate-400"}`}>{assignment?.telephonyEnabled ? "Enabled" : "Disabled"}</td>
                  <td className="px-4 py-4 text-slate-400">{formatActivity(assignment?.lastActivityAt ?? null)}</td>
                  <td className="space-y-3 px-4 py-4">
                    {recoverable && (
                      <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-3">
                        <p className="text-xs text-amber-200">This number is protected for its previous clinic.</p>
                        <button disabled={busy !== null || assignment !== null} onClick={() => setPending({
                          key: recoverable.id,
                          input: { action: "restorePreviousAssignment", numberId: recoverable.id, confirmed: true },
                          title: `Restore ${formatNumber(recoverable.phoneNumber)}?`,
                          body: `Restore ${formatNumber(recoverable.phoneNumber)} to ${clinic.name}. This restores only its previous ownership and does not expose the number to another organisation.`,
                          confirmLabel: "Restore assignment",
                          successMessage: recoverable.quarantineSourceTelephonyEnabled === null
                            ? "Number restored. Telephony remains disabled because the previous activation state could not be verified."
                            : "Previous IVR number assignment and telephony state restored.",
                        })} className="mt-2 font-semibold text-amber-300 hover:text-amber-200 disabled:opacity-50">{assignment ? "Another number is assigned" : "Restore assignment"}</button>
                      </div>
                    )}
                    <div className="flex flex-wrap gap-2">
                      <select aria-label={`Available IVR number for ${clinic.name}`} value={selected} onChange={(event) => setSelections((current) => ({ ...current, [clinic.id]: event.target.value }))} className="rounded-lg border border-slate-700 bg-[#090e23] px-3 py-2 text-xs text-white">
                        <option value="">Select available number</option>
                        {model.availableNumbers.map((item) => <option key={item.id} value={item.id}>{formatNumber(item.phoneNumber)}</option>)}
                      </select>
                      <button disabled={!selected || busy !== null} onClick={() => {
                        if (!assignment) {
                          void mutate(clinic.id, { action: "assign", clinicId: clinic.id, numberId: selected });
                          return;
                        }
                        if (!selectedNumber) return;
                        setPending({
                          key: clinic.id,
                          input: { action: "reassign", clinicId: clinic.id, numberId: selected, confirmed: true },
                          title: "Change IVR number?",
                          body: `${clinic.name} will change from ${formatNumber(assignment.phoneNumber)} to ${formatNumber(selectedNumber.phoneNumber)}. The current number will enter quarantine.`,
                          confirmLabel: "Change assignment",
                          successMessage: "IVR number assignment changed; the previous number is quarantined.",
                        });
                      }} className="rounded-lg bg-indigo-500 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-400 disabled:opacity-50">{assignment ? "Change assignment" : "Assign number"}</button>
                      {assignment && <button disabled={busy !== null} onClick={() => setPending({
                        key: clinic.id,
                        input: { action: "unassign", clinicId: clinic.id, numberId: assignment.id, confirmed: true },
                        title: "Unassign IVR number?",
                        body: `${formatNumber(assignment.phoneNumber)} will be disconnected from ${clinic.name}. The number will enter a ${model.quarantineDays}-day quarantine and will not be available to another organisation during that period. Incoming calls to this number will no longer resolve to this clinic after Platform inventory authority is active.`,
                        confirmLabel: "Unassign and quarantine",
                        successMessage: "IVR number unassigned and placed in quarantine.",
                      })} className="rounded-lg border border-rose-500/50 px-3 py-2 text-xs font-semibold text-rose-300 hover:bg-rose-500/10 disabled:opacity-50">Unassign</button>}
                    </div>
                    {assignment && model.clinics.length > 1 && (
                      <div className="flex flex-wrap gap-2 border-t border-slate-800 pt-3">
                        <select aria-label={`Move ${assignment.phoneNumber} to clinic`} value={moveTarget} onChange={(event) => setMoveTargets((current) => ({ ...current, [clinic.id]: event.target.value }))} className="rounded-lg border border-slate-700 bg-[#090e23] px-3 py-2 text-xs text-white">
                          <option value="">Move current number to…</option>
                          {model.clinics.filter((target) => target.id !== clinic.id).map((target) => <option key={target.id} value={target.id}>{target.name}</option>)}
                        </select>
                        <button disabled={!destination || busy !== null} onClick={() => destination && setPending({
                          key: clinic.id,
                          input: { action: "reassign", clinicId: destination.id, numberId: assignment.id, confirmed: true },
                          title: "Move IVR number?",
                          body: `Move ${formatNumber(assignment.phoneNumber)} from ${clinic.name} to ${destination.name}.${destination.assignment ? ` The destination's current number, ${formatNumber(destination.assignment.phoneNumber)}, will enter quarantine.` : ""}`,
                          confirmLabel: "Move number",
                          successMessage: "IVR number moved to the selected clinic.",
                        })} className="rounded-lg border border-slate-600 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-800 disabled:opacity-50">Move number</button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
            {model.clinics.length === 0 && <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-500">This organisation has no clinics.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-500">Only healthy, provider-present, available Plivo numbers appear in assignment selectors. Quarantined numbers remain protected for their previous clinic until restored or released.</p>
      <ConfirmDialog isOpen={pending !== null} onCancel={() => setPending(null)} onConfirm={() => void confirmPending()} title={pending?.title ?? "Confirm IVR number action"} body={pending?.body ?? ""} confirmLabel={pending?.confirmLabel ?? "Confirm"} tone="danger" isBusy={pending !== null && busy === pending.key} />
    </section>
  );
}
