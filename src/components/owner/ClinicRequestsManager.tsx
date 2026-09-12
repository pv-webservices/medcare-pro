"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, HandCoins, X } from "lucide-react";

type RequestRow = {
  id: string;
  requestType: "ADDITIONAL_CLINIC" | "PLAN_UPGRADE";
  requestedQuantity: number | null;
  status: string;
  paymentStatus: string;
  createdAt: string;
  tenant: { id: string; businessName: string; email: string; plan: { name: string } | null };
  requestedPlan: { name: string; includedClinics: number } | null;
  capacity: { usedClinics: number; effectiveLimit: number };
};

type InventoryRow = {
  tenantId: string;
  tenantName: string;
  tenantEmail: string;
  planName: string | null;
  usedClinics: number;
  effectiveLimit: number;
  status: string;
  activeGrants: { id: string; quantity: number; type: string }[];
};

type RequestDetail = {
  id: string;
  tenantId: string;
  requestType: "ADDITIONAL_CLINIC" | "PLAN_UPGRADE";
  requestedQuantity: number | null;
  status: string;
  paymentStatus: string;
  paymentReference: string | null;
  unitPriceSnapshot: string | null;
  currency: string | null;
  billingInterval: string | null;
  organizationNote: string | null;
  reviewNote: string | null;
  rejectionReason: string | null;
  createdAt: string;
  tenant: { businessName: string; plan: { name: string } | null };
  requestedBy: { name: string | null; email: string };
  requestedPlan: { name: string; includedClinics: number } | null;
  capacity: {
    usedClinics: number;
    effectiveLimit: number;
    includedClinics: number;
    activeGrantQuantity: number;
    activeGrants: { id: string; quantity: number; type: string }[];
  };
  featureImpact: {
    gained: { key: string; name: string }[];
    lost: { key: string; name: string }[];
  };
};

function human(value: string): string {
  return value.toLowerCase().replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}

export default function ClinicRequestsManager({ requests, inventory }: { requests: RequestRow[]; inventory: InventoryRow[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<RequestDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [acceptFeatureLoss, setAcceptFeatureLoss] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualTenantId, setManualTenantId] = useState(inventory.find((row) => row.planName)?.tenantId ?? "");
  const [manualQuantity, setManualQuantity] = useState("1");
  const [manualType, setManualType] = useState("COMPLIMENTARY");
  const [manualReason, setManualReason] = useState("");
  const panelRef = useRef<HTMLElement>(null);
  const reviewOpen = selected !== null || manualOpen;

  useEffect(() => {
    if (!reviewOpen) return;
    const opener = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.querySelector<HTMLElement>('button, input, select, textarea')?.focus();
    return () => {
      document.body.style.overflow = overflow;
      opener?.focus();
    };
  }, [reviewOpen]);

  function handleReviewKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape" && !busy) {
      event.preventDefault();
      setSelected(null);
      setManualOpen(false);
    }
    if (event.key !== "Tab") return;
    const controls = Array.from(panelRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]') ?? []);
    const first = controls[0];
    const last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }

  async function openRequest(id: string) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/owner/clinic-requests/${id}`);
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.error ?? "Could not load request.");
      setSelected(body.data);
      setNote(body.data.reviewNote ?? "");
      setReason("");
      setAcceptFeatureLoss(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load request.");
    } finally {
      setBusy(false);
    }
  }

  async function action(path: string, method: "POST" | "PATCH", data: unknown) {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/owner/clinic-requests/${selected.id}/${path}`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body.success) {
        setError(body.error ?? "The action could not be completed.");
        return;
      }
      setSelected(null);
      router.refresh();
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function createManualGrant(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/owner/clinic-capacity/grants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId: manualTenantId, quantity: Number(manualQuantity), type: manualType, reason: manualReason }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body.success) {
        setError(body.error ?? "Could not create the grant.");
        return;
      }
      setManualOpen(false);
      setManualReason("");
      router.refresh();
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function revokeGrant(id: string) {
    const revokeReason = window.prompt("Reason for revoking this capacity grant (minimum 10 characters):");
    if (!revokeReason) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/owner/clinic-capacity/grants/${id}/revoke`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: revokeReason }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body.success) setError(body.error ?? "Could not revoke the grant.");
      else { setSelected(null); router.refresh(); }
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      {error && !reviewOpen && <p role="alert" className="rounded-xl border border-rose-500/30 bg-rose-950/40 p-4 text-sm text-rose-200">{error}</p>}

      <div className="flex justify-end">
        <button onClick={() => setManualOpen(true)} className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500">
          <HandCoins className="h-4 w-4" /> Grant capacity manually
        </button>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-[#0d1427] shadow-lg">
        <table className="min-w-[900px] w-full text-left text-sm">
          <thead className="border-b border-slate-800 bg-slate-950/40 text-xs uppercase tracking-wide text-slate-500">
            <tr><th className="px-4 py-3">Organization</th><th>Plan</th><th>Usage</th><th>Request</th><th>Payment</th><th>Status</th><th>Submitted</th><th className="pr-4 text-right">Action</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-800/80">
            {requests.map((request) => (
              <tr key={request.id} className="text-slate-300">
                <td className="px-4 py-4"><p className="font-semibold text-white">{request.tenant.businessName}</p><p className="text-xs text-slate-500">{request.tenant.email}</p></td>
                <td>{request.tenant.plan?.name ?? "No plan"}</td>
                <td className="tabular-nums">{request.capacity.usedClinics} / {request.capacity.effectiveLimit}</td>
                <td>{request.requestType === "ADDITIONAL_CLINIC" ? `+${request.requestedQuantity}` : request.requestedPlan?.name}</td>
                <td>{human(request.paymentStatus)}</td>
                <td><span className="rounded-full border border-indigo-500/30 bg-indigo-950/50 px-2.5 py-1 text-xs text-indigo-300">{human(request.status)}</span></td>
                <td>{new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" }).format(new Date(request.createdAt))}</td>
                <td className="pr-4 text-right"><button disabled={busy} onClick={() => openRequest(request.id)} className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800">Review</button></td>
              </tr>
            ))}
            {requests.length === 0 && <tr><td colSpan={8} className="px-5 py-12 text-center text-slate-500">No clinic capacity requests match this view.</td></tr>}
          </tbody>
        </table>
      </div>

      {(selected || manualOpen) && <div className="fixed inset-0 z-50 flex justify-end">
        <button aria-label="Close review" disabled={busy} className="absolute inset-0 bg-black/70" onClick={() => { setSelected(null); setManualOpen(false); }} />
        <aside ref={panelRef} role="dialog" aria-modal="true" aria-label={manualOpen ? "Grant clinic capacity" : "Review clinic capacity request"} onKeyDown={handleReviewKeyDown} className="relative h-full w-full max-w-xl overflow-y-auto border-l border-slate-800 bg-[#080d1e] p-5 text-white shadow-2xl sm:p-7">
          <div className="flex items-start justify-between gap-4"><div><h2 className="text-xl font-bold">{manualOpen ? "Grant clinic capacity" : selected?.tenant.businessName}</h2>{selected && <p className="mt-1 text-xs text-slate-500">Tenant ID {selected.tenantId}</p>}</div><button aria-label="Close review" disabled={busy} onClick={() => { setSelected(null); setManualOpen(false); }} className="rounded-lg p-2 text-slate-400 hover:bg-slate-800"><X className="h-5 w-5" /></button></div>

          {error && <p role="alert" className="mt-5 rounded-xl border border-rose-500/30 bg-rose-950/40 p-4 text-sm text-rose-200">{error}</p>}
          {manualOpen ? <form onSubmit={createManualGrant} className="mt-7 space-y-5">
            <label className="block text-sm text-slate-300">Organization<select value={manualTenantId} onChange={(e) => setManualTenantId(e.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-3 text-white">{inventory.filter((row) => row.planName).map((row) => <option key={row.tenantId} value={row.tenantId}>{row.tenantName} · {row.usedClinics}/{row.effectiveLimit}</option>)}</select></label>
            <label className="block text-sm text-slate-300">Quantity<input type="number" min={1} max={100} value={manualQuantity} onChange={(e) => setManualQuantity(e.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-3 text-white" /></label>
            <label className="block text-sm text-slate-300">Type<select value={manualType} onChange={(e) => setManualType(e.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-3 text-white"><option value="COMPLIMENTARY">Complimentary</option><option value="PAID_ADDON">Paid add-on</option><option value="ENTERPRISE">Enterprise</option><option value="MIGRATION">Migration</option></select></label>
            <label className="block text-sm text-slate-300">Reason<textarea rows={4} required value={manualReason} onChange={(e) => setManualReason(e.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-3 text-white" /></label>
            {(inventory.find((row) => row.tenantId === manualTenantId)?.activeGrants.length ?? 0) > 0 && <div className="rounded-xl border border-slate-800 p-4 text-sm"><p className="font-semibold">Existing active grants</p>{inventory.find((row) => row.tenantId === manualTenantId)?.activeGrants.map((grant) => <div key={grant.id} className="mt-3 flex items-center justify-between gap-3"><span>+{grant.quantity} · {human(grant.type)}</span><button type="button" disabled={busy} onClick={() => revokeGrant(grant.id)} className="text-xs font-semibold text-rose-300">Revoke</button></div>)}</div>}
            <button disabled={busy || manualReason.trim().length < 10} className="rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Granting…" : "Grant capacity"}</button>
          </form> : selected && <div className="mt-7 space-y-5">
            <div className="grid grid-cols-2 gap-3 rounded-2xl border border-slate-800 bg-[#0d1427] p-4 text-sm">
              <p className="text-slate-500">Current plan<br/><span className="text-white">{selected.tenant.plan?.name ?? "No plan"}</span></p><p className="text-slate-500">Clinic usage<br/><span className="text-white">{selected.capacity.usedClinics} / {selected.capacity.effectiveLimit}</span></p>
              <p className="text-slate-500">Included clinics<br/><span className="text-white">{selected.capacity.includedClinics}</span></p><p className="text-slate-500">Active add-ons<br/><span className="text-white">+{selected.capacity.activeGrantQuantity}</span></p>
              <p className="text-slate-500">Request<br/><span className="text-white">{selected.requestType === "ADDITIONAL_CLINIC" ? `+${selected.requestedQuantity} clinics` : selected.requestedPlan?.name}</span></p>
              <p className="text-slate-500">New effective limit<br/><span className="text-white">{selected.requestType === "ADDITIONAL_CLINIC" ? selected.capacity.effectiveLimit + (selected.requestedQuantity ?? 0) : (selected.requestedPlan?.includedClinics ?? selected.capacity.effectiveLimit) + selected.capacity.activeGrantQuantity}</span></p>
              <p className="text-slate-500">Price snapshot<br/><span className="text-white">{selected.unitPriceSnapshot && selected.currency ? `${selected.currency} ${selected.unitPriceSnapshot}${selected.billingInterval ? ` / ${human(selected.billingInterval)}` : ""}` : "Contact MEDCARE PRO for pricing"}</span></p>
              <p className="text-slate-500">Payment<br/><span className="text-white">{human(selected.paymentStatus)}</span></p>
              <p className="col-span-2 text-slate-500">Submitted by<br/><span className="text-white">{selected.requestedBy.name ?? selected.requestedBy.email} · {new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(selected.createdAt))}</span></p>
            </div>
            {selected.paymentReference && <div className="rounded-xl border border-slate-800 p-4 text-sm"><p className="text-slate-500">Payment reference</p><p className="mt-1 break-all text-white">{selected.paymentReference}</p></div>}
            {selected.organizationNote && <div className="rounded-xl border border-slate-800 p-4 text-sm"><p className="text-slate-500">Organization note</p><p className="mt-1 whitespace-pre-wrap text-slate-200">{selected.organizationNote}</p></div>}
            {selected.requestType === "PLAN_UPGRADE" && <div className="rounded-xl border border-slate-800 p-4 text-sm"><p className="font-semibold">Plan impact</p><p className="mt-2 text-emerald-300">Features gained: {selected.featureImpact.gained.map((feature) => feature.name).join(", ") || "None"}</p><p className={selected.featureImpact.lost.length ? "mt-1 text-amber-300" : "mt-1 text-slate-400"}>Features lost: {selected.featureImpact.lost.map((feature) => feature.name).join(", ") || "None"}</p>{selected.featureImpact.lost.length > 0 && <label className="mt-3 flex gap-2 text-amber-200"><input type="checkbox" checked={acceptFeatureLoss} onChange={(e) => setAcceptFeatureLoss(e.target.checked)} />I reviewed and accept this feature removal.</label>}</div>}
            {selected.capacity.activeGrants.length > 0 && <div className="rounded-xl border border-slate-800 p-4 text-sm"><p className="font-semibold">Active grants</p>{selected.capacity.activeGrants.map((grant) => <div key={grant.id} className="mt-3 flex items-center justify-between gap-3"><span>+{grant.quantity} · {human(grant.type)}</span><button disabled={busy} onClick={() => revokeGrant(grant.id)} className="text-xs font-semibold text-rose-300">Revoke</button></div>)}</div>}
            {["PENDING", "PAYMENT_PENDING", "PAYMENT_SUBMITTED", "UNDER_REVIEW"].includes(selected.status) && <>
              <label className="block text-sm text-slate-300">Review note<textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-3 text-white" /></label>
              {selected.requestType === "ADDITIONAL_CLINIC" && !["CONFIRMED", "WAIVED", "NOT_REQUIRED"].includes(selected.paymentStatus) && <div className="flex flex-wrap gap-2"><button disabled={busy} onClick={() => action("payment", "PATCH", { paymentStatus: "CONFIRMED", reviewNote: note })} className="rounded-xl border border-emerald-500/40 px-4 py-2 text-sm font-semibold text-emerald-300"><Check className="mr-1 inline h-4 w-4"/>Confirm payment</button><button disabled={busy} onClick={() => action("payment", "PATCH", { paymentStatus: "WAIVED", reviewNote: note })} className="rounded-xl border border-slate-700 px-4 py-2 text-sm font-semibold text-white">Waive payment</button></div>}
              <div className="flex flex-wrap gap-2 border-t border-slate-800 pt-5"><button disabled={busy || (selected.featureImpact?.lost?.length > 0 && !acceptFeatureLoss)} onClick={() => action("approve", "POST", { confirmation: selected.id, reviewNote: note, acceptFeatureLoss })} className="rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50">Approve</button><button disabled={busy || reason.trim().length < 10} onClick={() => action("reject", "POST", { reason })} className="rounded-xl border border-rose-500/40 px-5 py-2.5 text-sm font-semibold text-rose-300">Reject</button></div>
              <label className="block text-sm text-slate-300">Rejection reason (required to reject)<textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-3 text-white" /></label>
            </>}
            {selected.status === "REJECTED" && <div className="rounded-xl border border-rose-500/30 bg-rose-950/30 p-4 text-sm text-rose-200"><AlertTriangle className="mr-2 inline h-4 w-4" />{selected.rejectionReason}</div>}
          </div>}
        </aside>
      </div>}
    </div>
  );
}
