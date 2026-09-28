"use client";

import { useState } from "react";
import Button from "@/components/ui/Button";
import Select from "@/components/ui/Select";
import { formatRupees } from "@/lib/money";
import { serviceCategories } from "@/lib/billing/billingValidation";
import type { ServiceItemRecord } from "@/lib/billing/serviceItems";
import type { BillingClinicOption } from "./BillingSettingsForm";
import ServiceItemForm from "./ServiceItemForm";

export default function ServiceItemList({ initialItems, clinics, canManageAll, selectedClinicId }: {
  initialItems: ServiceItemRecord[]; clinics: BillingClinicOption[]; canManageAll: boolean; selectedClinicId: string | null;
}) {
  const [items, setItems] = useState(initialItems);
  const [category, setCategory] = useState("");
  const [clinicId, setClinicId] = useState(selectedClinicId ?? "");
  const [state, setState] = useState("active");
  const [editing, setEditing] = useState<ServiceItemRecord | null | undefined>(undefined);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const canEdit = (item: ServiceItemRecord) => item.clinicId === null ? canManageAll : clinics.some((clinic) => clinic.id === item.clinicId && clinic.canManage);
  const canCreate = canManageAll || clinics.some((clinic) => clinic.canManage);
  function saved(item: ServiceItemRecord) {
    setItems((current) => [...current.filter((row) => row.id !== item.id), item].sort((a, b) => a.name.localeCompare(b.name)));
    setEditing(undefined);
  }
  async function toggle(item: ServiceItemRecord) {
    setBusy(item.id); setError("");
    try {
      const response = await fetch(`/api/billing/services/${item.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isActive: !item.isActive }) });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error ?? "Could not update service.");
      saved(result.data);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not update service."); }
    finally { setBusy(null); }
  }
  const visible = items.filter((item) => (!category || item.category === category)
    && (!clinicId || item.clinicId === null || item.clinicId === clinicId)
    && (state === "all" || item.isActive === (state === "active")));
  return <section className="rounded-2xl border border-line bg-canvas p-5 space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-semibold text-ink">Service price list</h2><p className="text-sm text-muted">Prices exclude GST. Retired services remain in billing history.</p></div>
      {canCreate && <Button onClick={() => setEditing(null)}>Add service</Button>}</div>
    {!canCreate && <p className="text-sm text-muted">View only — your role cannot change the price list.</p>}
    <div className="grid gap-3 sm:grid-cols-3">
      <Select id="filter-service-category" label="Category" value={category} onChange={(event) => setCategory(event.target.value)}><option value="">All categories</option>{serviceCategories.map((value) => <option key={value} value={value}>{value.charAt(0) + value.slice(1).toLowerCase()}</option>)}</Select>
      <Select id="filter-service-clinic" label="Available at" value={clinicId} onChange={(event) => setClinicId(event.target.value)}><option value="">All permitted clinics</option>{clinics.map((clinic) => <option key={clinic.id} value={clinic.id}>{clinic.name}</option>)}</Select>
      <Select id="filter-service-state" label="Status" value={state} onChange={(event) => setState(event.target.value)}><option value="active">Active</option><option value="retired">Retired</option><option value="all">Active and retired</option></Select>
    </div>
    {error && <p role="alert" className="text-sm text-alert-ink">{error}</p>}
    <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="text-muted"><tr>{["Service", "Category", "Scope", "Price", "GST", "SAC", "Status", "Actions"].map((title) => <th key={title} scope="col" className="p-3 font-medium">{title}</th>)}</tr></thead>
      <tbody>{visible.map((item) => <tr key={item.id} className="border-t border-line">
        <td className="p-3 font-medium text-ink">{item.name}</td><td className="p-3">{item.category.charAt(0) + item.category.slice(1).toLowerCase()}</td>
        <td className="p-3">{item.clinicId ? clinics.find((clinic) => clinic.id === item.clinicId)?.name : "All clinics"}</td>
        <td className="p-3 whitespace-nowrap">{formatRupees(item.price)}</td><td className="p-3">{item.taxRatePercent}%</td><td className="p-3">{item.sacCode ?? "—"}</td><td className="p-3">{item.isActive ? "Active" : "Retired"}</td>
        <td className="p-3">{canEdit(item) ? <div className="flex gap-2"><Button size="sm" variant="secondary" disabled={busy !== null} onClick={() => setEditing(item)} aria-label={`Edit ${item.name}`}>Edit</Button><Button size="sm" variant="ghost" disabled={busy !== null} isBusy={busy === item.id} onClick={() => toggle(item)} aria-label={`${item.isActive ? "Retire" : "Restore"} ${item.name}`}>{item.isActive ? "Retire" : "Restore"}</Button></div> : <span className="text-muted">View only</span>}</td>
      </tr>)}</tbody></table></div>
    {visible.length === 0 && <p className="text-sm text-muted">No services match these filters.</p>}
    {editing !== undefined && <ServiceItemForm item={editing} clinics={clinics} canManageAll={canManageAll} onClose={() => setEditing(undefined)} onSaved={saved} />}
  </section>;
}
