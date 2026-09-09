"use client";

import { useState } from "react";
import type { PlatformTenantIvrView } from "@/lib/platform/plivoNumbers";

function formatNumber(value: string): string {
  return /^\+91\d{10}$/.test(value)
    ? `${value.slice(0, 3)} ${value.slice(3, 5)} ${value.slice(5, 9)} ${value.slice(9)}`
    : value;
}

function healthLabel(value: string): string {
  if (value === "HEALTHY") return "Healthy";
  if (value === "OUT_OF_SYNC") return "Wrong application";
  return "Missing from Plivo";
}

function formatActivity(value: string | null): string {
  if (!value) return "No recent calls";
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  }).format(new Date(value));
}

export default function PlatformTenantIvr({
  initialModel,
}: {
  initialModel: PlatformTenantIvrView;
}) {
  const [model, setModel] = useState(initialModel);
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [moveTargets, setMoveTargets] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function mutate(
    key: string,
    input: Record<string, unknown>,
    confirmation?: string,
  ) {
    if (confirmation && !window.confirm(confirmation)) return;
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
      setMessage("IVR number assignment updated.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The assignment could not be changed.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="space-y-4">
      {message && <p role="status" className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-sm text-slate-200">{message}</p>}
      <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-[#0d1427]">
        <table className="w-full min-w-[960px] text-left text-sm">
          <thead className="border-b border-slate-800 text-xs uppercase tracking-wide text-slate-500"><tr>{["Clinic", "IVR number", "Status", "Last activity", "Platform actions"].map((heading) => <th key={heading} className="px-4 py-3">{heading}</th>)}</tr></thead>
          <tbody>
            {model.clinics.map((clinic) => {
              const assignment = clinic.assignment;
              const selected = selections[clinic.id] ?? "";
              const moveTarget = moveTargets[clinic.id] ?? "";
              return (
                <tr key={clinic.id} className="border-b border-slate-800/70 align-top last:border-0">
                  <td className="px-4 py-4 font-semibold text-white">{clinic.name}</td>
                  <td className="px-4 py-4 font-mono text-slate-200">{assignment ? formatNumber(assignment.phoneNumber) : "No number"}</td>
                  <td className="px-4 py-4"><span className={assignment?.healthStatus === "HEALTHY" && !assignment.assignmentIssue ? "text-emerald-400" : assignment ? "text-amber-400" : "text-slate-500"}>{assignment ? assignment.assignmentIssue ? "Needs platform attention" : healthLabel(assignment.healthStatus) : "Not set"}</span></td>
                  <td className="px-4 py-4 text-slate-400">{formatActivity(assignment?.lastActivityAt ?? null)}</td>
                  <td className="space-y-3 px-4 py-4">
                    <div className="flex flex-wrap gap-2">
                      <select aria-label={`Available IVR number for ${clinic.name}`} value={selected} onChange={(event) => setSelections((current) => ({ ...current, [clinic.id]: event.target.value }))} className="rounded-lg border border-slate-700 bg-[#090e23] px-3 py-2 text-xs text-white">
                        <option value="">Select available number</option>
                        {model.availableNumbers.map((number) => <option key={number.id} value={number.id}>{formatNumber(number.phoneNumber)}</option>)}
                      </select>
                      <button disabled={!selected || busy !== null} onClick={() => mutate(clinic.id, { action: assignment ? "reassign" : "assign", clinicId: clinic.id, numberId: selected, ...(assignment ? { confirmed: true } : {}) }, assignment ? `Replace ${formatNumber(assignment.phoneNumber)} for ${clinic.name}? The old number will be quarantined.` : undefined)} className="rounded-lg bg-indigo-500 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-400 disabled:opacity-50">
                        {assignment ? "Change assignment" : "Assign number"}
                      </button>
                      {assignment && <button disabled={busy !== null} onClick={() => mutate(clinic.id, { action: "unassign", clinicId: clinic.id, numberId: assignment.id, confirmed: true }, `Unassign ${formatNumber(assignment.phoneNumber)} from ${clinic.name}? It will enter quarantine.`)} className="rounded-lg border border-rose-500/50 px-3 py-2 text-xs font-semibold text-rose-300 hover:bg-rose-500/10 disabled:opacity-50">Unassign</button>}
                    </div>
                    {assignment && model.clinics.length > 1 && (
                      <div className="flex flex-wrap gap-2 border-t border-slate-800 pt-3">
                        <select aria-label={`Move ${assignment.phoneNumber} to clinic`} value={moveTarget} onChange={(event) => setMoveTargets((current) => ({ ...current, [clinic.id]: event.target.value }))} className="rounded-lg border border-slate-700 bg-[#090e23] px-3 py-2 text-xs text-white">
                          <option value="">Move current number to…</option>
                          {model.clinics.filter((target) => target.id !== clinic.id).map((target) => <option key={target.id} value={target.id}>{target.name}</option>)}
                        </select>
                        <button disabled={!moveTarget || busy !== null} onClick={() => mutate(clinic.id, { action: "reassign", clinicId: moveTarget, numberId: assignment.id, confirmed: true }, `Move ${formatNumber(assignment.phoneNumber)} to the selected clinic? Any number currently there will be quarantined.`)} className="rounded-lg border border-slate-600 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-800 disabled:opacity-50">Move number</button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
            {model.clinics.length === 0 && <tr><td colSpan={5} className="px-4 py-10 text-center text-slate-500">This organisation has no clinics.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-500">Only healthy, provider-present, available Plivo numbers appear in assignment selectors. All checks are repeated on the server.</p>
    </section>
  );
}
