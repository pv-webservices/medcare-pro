"use client";

import { useState, type FormEvent } from "react";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import Modal from "@/components/ui/Modal";
import { serviceCategories } from "@/lib/billing/billingValidation";
import type { ServiceItemRecord } from "@/lib/billing/serviceItems";
import type { BillingClinicOption } from "./BillingSettingsForm";

export default function ServiceItemForm({ item, clinics, canManageAll, onClose, onSaved }: {
  item: ServiceItemRecord | null; clinics: BillingClinicOption[]; canManageAll: boolean;
  onClose: () => void; onSaved: (item: ServiceItemRecord) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const editableClinics = clinics.filter((clinic) => clinic.canManage);
  const [category, setCategory] = useState<string>(item?.category ?? "CONSULTATION");
  const [clinicId, setClinicId] = useState(item ? item.clinicId ?? "" : canManageAll ? "" : editableClinics[0]?.id ?? "");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const data = Object.fromEntries(form);
    setBusy(true); setError("");
    try {
      const response = await fetch(item ? `/api/billing/services/${item.id}` : "/api/billing/services", {
        method: item ? "PATCH" : "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...data, clinicId: data.clinicId || null }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error ?? "Could not save service.");
      onSaved(result.data);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not save service."); }
    finally { setBusy(false); }
  }
  return <Modal isOpen onClose={onClose} title={item ? "Edit service" : "Add service"} isBusy={busy} size="lg">
    <form onSubmit={submit} className="space-y-4">
      <fieldset disabled={busy} className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2"><Input id="service-name" name="name" label="Service name" required maxLength={120} defaultValue={item?.name ?? ""} /></div>
        <Select id="service-category" name="category" label="Category" value={category} onChange={(event) => setCategory(event.target.value)}>
          {serviceCategories.map((category) => <option key={category} value={category}>{category.charAt(0) + category.slice(1).toLowerCase()}</option>)}
        </Select>
        <Select id="service-scope" name="clinicId" label="Scope" value={clinicId} onChange={(event) => setClinicId(event.target.value)}>
          {canManageAll && <option value="">All clinics</option>}
          {editableClinics.map((clinic) => <option key={clinic.id} value={clinic.id}>{clinic.name}</option>)}
        </Select>
        <Input id="service-price" name="price" label="Price (₹, excluding GST)" required type="number" min="0" max="99999999.99" step="0.01" defaultValue={item?.price ?? ""} />
        <Input id="service-tax" name="taxRatePercent" label="GST rate (%)" required type="number" min="0" max="40" step="0.01" defaultValue={item?.taxRatePercent ?? "0.00"} />
        <Input id="service-sac" name="sacCode" label="SAC code (optional)" pattern="[0-9]{1,8}" maxLength={8} defaultValue={item?.sacCode ?? ""} />
      </fieldset>
      {error && <p role="alert" className="text-sm text-alert-ink">{error}</p>}
      <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button type="submit" isBusy={busy}>Save service</Button></div>
    </form>
  </Modal>;
}
