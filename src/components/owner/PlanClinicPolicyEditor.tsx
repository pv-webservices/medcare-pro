"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Building2 } from "lucide-react";
import type { PlanAdminRow } from "@/lib/platform/entitlements";

function PlanPolicy({ plan }: { plan: PlanAdminRow }) {
  const router = useRouter();
  const [included, setIncluded] = useState(String(plan.includedClinics));
  const [price, setPrice] = useState(plan.additionalClinicPrice ?? "");
  const [currency, setCurrency] = useState(plan.additionalClinicCurrency);
  const [interval, setInterval] = useState(plan.additionalClinicBillingInterval ?? "");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const decreases = Number(included) < plan.includedClinics;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    const response = await fetch("/api/owner/plans/clinic-policy", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        planKey: plan.key,
        includedClinics: Number(included),
        additionalClinicPrice: price.trim() || null,
        additionalClinicCurrency: currency,
        additionalClinicBillingInterval: interval || null,
        reason,
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body.success) setMessage(body.error ?? "Could not save clinic policy.");
    else { setMessage("Clinic policy saved and audited."); setReason(""); router.refresh(); }
    setBusy(false);
  }

  return <form onSubmit={submit} className="rounded-2xl border border-slate-800 bg-[#0d1427] p-5 shadow-lg">
    <div className="flex items-start justify-between gap-4"><div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl border border-indigo-500/30 bg-indigo-950/60 text-indigo-300"><Building2 className="h-5 w-5"/></span><div><h3 className="font-semibold text-white">{plan.name}</h3><p className="text-xs text-slate-500">{plan.tenantCount} organization{plan.tenantCount === 1 ? "" : "s"} on this plan</p></div></div><span className="rounded-full border border-slate-700 px-2.5 py-1 text-xs text-slate-400">{plan.isActive ? "Active" : "Retired"}</span></div>
    <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <label className="text-xs font-medium text-slate-300">Included clinics<input type="number" min={1} max={10000} value={included} onChange={(e) => setIncluded(e.target.value)} className="mt-1.5 min-h-11 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 text-white"/></label>
      <label className="text-xs font-medium text-slate-300">Additional clinic price<input inputMode="decimal" placeholder="Contact for pricing" value={price} onChange={(e) => setPrice(e.target.value)} className="mt-1.5 min-h-11 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 text-white"/></label>
      <label className="text-xs font-medium text-slate-300">Currency<input maxLength={3} value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} className="mt-1.5 min-h-11 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 uppercase text-white"/></label>
      <label className="text-xs font-medium text-slate-300">Billing interval<select value={interval} onChange={(e) => setInterval(e.target.value)} className="mt-1.5 min-h-11 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 text-white"><option value="">Not configured</option><option value="MONTHLY">Monthly</option><option value="YEARLY">Yearly</option><option value="ONE_TIME">One time</option></select></label>
    </div>
    {decreases && <p className="mt-4 flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-950/30 p-3 text-xs text-amber-200"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0"/>Existing clinics remain operational. Organizations above the new allowance will be marked over limit and only future clinic creation will be blocked.</p>}
    <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end"><label className="flex-1 text-xs font-medium text-slate-300">Reason (required)<textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-white"/></label><button disabled={busy || reason.trim().length < 10} className="min-h-11 rounded-xl bg-indigo-600 px-5 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Saving…" : "Save clinic policy"}</button></div>
    {message && <p className={`mt-3 text-xs ${message.includes("saved") ? "text-emerald-300" : "text-rose-300"}`}>{message}</p>}
  </form>;
}

export default function PlanClinicPolicyEditor({ plans }: { plans: PlanAdminRow[] }) {
  return <section className="space-y-4"><div><h2 className="text-lg font-semibold text-white">Clinic capacity policy</h2><p className="mt-1 text-xs text-slate-400">Plan allowance plus active approved grants determines each organization&apos;s effective clinic limit. Leave price empty to show “Contact MEDCARE PRO for pricing”.</p></div><div className="space-y-4">{plans.map((plan) => <PlanPolicy key={plan.key} plan={plan}/>)}</div></section>;
}

