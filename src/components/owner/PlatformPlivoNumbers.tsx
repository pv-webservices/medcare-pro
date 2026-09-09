"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ConfirmDialog } from "@/components/ui/Modal";
import type { PlatformPlivoInventoryView } from "@/lib/platform/plivoNumbers";

type Filter = "all" | "available" | "assigned" | "quarantined" | "issues";
type InventoryRow = PlatformPlivoInventoryView["numbers"][number];
type PendingAction = { kind: "restore" | "release" | "releaseEarly"; row: InventoryRow };

function formatNumber(value: string): string {
  return /^\+91\d{10}$/.test(value)
    ? `${value.slice(0, 3)} ${value.slice(3, 5)} ${value.slice(5, 9)} ${value.slice(9)}`
    : value;
}

function formatDate(value: string | null): string {
  if (!value) return "Never";
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  }).format(new Date(value));
}

function providerLabel(health: string): string {
  if (health === "HEALTHY") return "Healthy";
  if (health === "OUT_OF_SYNC") return "Wrong application";
  return "Missing from Plivo";
}

function assignmentLabel(status: string): string {
  return status.charAt(0) + status.slice(1).toLowerCase();
}

export default function PlatformPlivoNumbers({
  initialInventory,
}: {
  initialInventory: PlatformPlivoInventoryView;
}) {
  const [inventory, setInventory] = useState(initialInventory);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [releaseReason, setReleaseReason] = useState("");

  const rows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return inventory.numbers.filter((row) => {
      const filterMatch = filter === "all" ||
        (filter === "available" && row.assignmentStatus === "AVAILABLE") ||
        (filter === "assigned" && row.assignmentStatus === "ASSIGNED") ||
        (filter === "quarantined" && row.assignmentStatus === "QUARANTINED") ||
        (filter === "issues" && (row.healthStatus !== "HEALTHY" || row.assignmentIssue));
      const searchMatch = !query || [row.phoneNumber, row.assignedTenantName, row.assignedClinicName, row.quarantineSourceTenantName, row.quarantineSourceClinicName]
        .some((value) => value?.toLowerCase().includes(query));
      return filterMatch && searchMatch;
    });
  }, [filter, inventory.numbers, search]);

  async function act(path: string, body?: unknown, key = "sync") {
    setBusy(key);
    setMessage(null);
    try {
      const response = await fetch(path, {
        method: "POST",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const payload = await response.json();
      if (!response.ok || !payload.success) throw new Error(payload.error ?? "The action failed.");
      setInventory(payload.data);
      setMessage(key === "sync" ? "Plivo inventory synchronized." : "IVR number state updated.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The action failed.");
    } finally {
      setBusy(null);
    }
  }

  async function confirmAction() {
    if (!pending) return;
    if (pending.kind === "releaseEarly" && releaseReason.trim().length < 10) {
      setMessage("Enter a reason of at least 10 characters before releasing quarantine early.");
      return;
    }
    const body = pending.kind === "restore"
      ? { action: "restorePreviousAssignment", numberId: pending.row.id, confirmed: true }
      : pending.kind === "release"
        ? { action: "releaseQuarantine", numberId: pending.row.id, confirmed: true }
        : { action: "releaseQuarantineEarly", numberId: pending.row.id, confirmed: true, reason: releaseReason.trim() };
    await act("/api/owner/ivr-numbers", body, pending.row.id);
    setPending(null);
    setReleaseReason("");
  }

  const summary = inventory.summary;
  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">IVR numbers</h1>
          <p className="mt-1 text-sm text-slate-400">Manage MEDCARE PRO&apos;s Plivo numbers, assignments and provider health.</p>
        </div>
        <button disabled={busy !== null} onClick={() => act("/api/owner/ivr-numbers/sync")} className="rounded-xl bg-indigo-500 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-400 disabled:opacity-50">
          {busy === "sync" ? "Syncing…" : "Sync with Plivo"}
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {[["Total", summary.total], ["Available", summary.available], ["Assigned", summary.assigned], ["Quarantined", summary.quarantined], ["Provider issues", summary.providerIssues]].map(([label, value]) => (
          <div key={label} className="rounded-2xl border border-slate-800 bg-[#0d1427] p-4">
            <p className="text-xs text-slate-400">{label}</p><p className="mt-1 text-2xl font-bold">{value}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        {(["all", "available", "assigned", "quarantined", "issues"] as Filter[]).map((item) => (
          <button key={item} onClick={() => setFilter(item)} className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${filter === item ? "bg-indigo-500 text-white" : "bg-slate-800 text-slate-300"}`}>{item === "issues" ? "Provider issues" : assignmentLabel(item.toUpperCase())}</button>
        ))}
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search number, organisation or clinic" className="min-w-64 flex-1 rounded-lg border border-slate-700 bg-[#090e23] px-3 py-1.5 text-sm text-white outline-none focus:border-indigo-500" />
      </div>
      {message && <p role="status" className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-sm text-slate-200">{message}</p>}

      <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-[#0d1427]">
        <table className="w-full min-w-[980px] text-left text-sm">
          <thead className="border-b border-slate-800 text-xs uppercase tracking-wide text-slate-500"><tr>{["IVR number", "Provider status", "Assignment", "Organisation", "Clinic", "Plivo application", "Last synced", "Actions"].map((heading) => <th key={heading} className="px-4 py-3">{heading}</th>)}</tr></thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-slate-800/70 last:border-0">
                <td className="px-4 py-4 font-mono font-semibold text-white">{formatNumber(row.phoneNumber)}</td>
                <td className={`px-4 py-4 font-medium ${row.healthStatus === "HEALTHY" && !row.assignmentIssue ? "text-emerald-400" : "text-amber-400"}`}>{row.assignmentIssue ? "Assignment mismatch" : providerLabel(row.healthStatus)}</td>
                <td className="px-4 py-4 text-slate-300">{assignmentLabel(row.assignmentStatus)}{row.quarantineExpired ? " · Expired" : ""}</td>
                <td className="px-4 py-4 text-slate-300">{row.assignedTenantName ?? row.quarantineSourceTenantName ?? "—"}</td>
                <td className="px-4 py-4 text-slate-300">{row.assignedClinicName ?? row.quarantineSourceClinicName ?? "—"}</td>
                <td className="px-4 py-4 text-slate-300">{row.providerApplicationName ?? (row.providerApplicationId ? "Configured application" : "No application")}</td>
                <td className="px-4 py-4 text-slate-400">{formatDate(row.lastSyncedAt)}</td>
                <td className="px-4 py-4">
                  {row.assignedTenantId ? (
                    <Link href={`/owner/applications/${row.assignedTenantId}/ivr`} className="font-semibold text-indigo-400 hover:text-indigo-300">View</Link>
                  ) : row.assignmentStatus === "QUARANTINED" ? (
                    <div className="space-y-2 text-xs">
                      <p className="text-amber-300">Quarantined until<br />{formatDate(row.quarantinedUntil)}</p>
                      {row.quarantineSourceClinicId && row.quarantineSourceTenantId && (
                        <button disabled={busy !== null} onClick={() => setPending({ kind: "restore", row })} className="block font-semibold text-emerald-400 hover:text-emerald-300 disabled:opacity-50">Restore to {row.quarantineSourceClinicName ?? "previous clinic"}</button>
                      )}
                      {row.quarantineExpired ? (
                        <button disabled={busy !== null} onClick={() => setPending({ kind: "release", row })} className="block font-semibold text-indigo-400 hover:text-indigo-300 disabled:opacity-50">Make available</button>
                      ) : row.providerPresent && row.healthStatus === "HEALTHY" ? (
                        <button disabled={busy !== null} onClick={() => setPending({ kind: "releaseEarly", row })} className="block font-semibold text-rose-300 hover:text-rose-200 disabled:opacity-50">Release early</button>
                      ) : null}
                    </div>
                  ) : row.assignmentStatus === "AVAILABLE" && row.healthStatus === "HEALTHY" ? (
                    <Link href="/owner/applications" className="font-semibold text-indigo-400 hover:text-indigo-300">Assign</Link>
                  ) : (
                    <span className="text-slate-500">View after provider fix</span>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={8} className="px-4 py-10 text-center text-slate-500">No IVR numbers match these filters.</td></tr>}
          </tbody>
        </table>
      </div>
      <ConfirmDialog
        isOpen={pending !== null}
        onCancel={() => { setPending(null); setReleaseReason(""); }}
        onConfirm={() => void confirmAction()}
        title={pending?.kind === "restore" ? "Restore previous assignment?" : pending?.kind === "releaseEarly" ? "Release quarantined number early?" : "Make IVR number available?"}
        body={pending?.kind === "releaseEarly" ? (
          <div className="space-y-4">
            <p>This bypasses the 14-day protection. The number may still be known by patients of the previous clinic and, once released, can be assigned to another organisation.</p>
            <label className="block text-sm font-semibold text-ink">Reason
              <textarea value={releaseReason} onChange={(event) => setReleaseReason(event.target.value)} rows={3} maxLength={500} className="mt-2 w-full rounded-lg border border-line bg-surface px-3 py-2 font-normal text-ink outline-none focus:border-danger" placeholder="Why is early release necessary?" />
            </label>
          </div>
        ) : pending?.kind === "restore" ? `Restore ${formatNumber(pending.row.phoneNumber)} to ${pending.row.quarantineSourceClinicName ?? "its previous clinic"}? This restores only the previous ownership and does not expose the number to another organisation.` : pending ? `${formatNumber(pending.row.phoneNumber)} has completed quarantine and will become available for assignment across the Platform.` : ""}
        confirmLabel={pending?.kind === "restore" ? "Restore assignment" : pending?.kind === "releaseEarly" ? "Release early" : "Make available"}
        tone="danger"
        isBusy={pending !== null && busy === pending.row.id}
      />
    </section>
  );
}
