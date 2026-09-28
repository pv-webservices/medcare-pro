"use client";

import { useState, type FormEvent } from "react";
import Button from "@/components/ui/Button";
import Input, { Textarea } from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import type { BillingSettingsRecord } from "@/lib/billing/billingSettings";

export interface BillingClinicOption { id: string; name: string; canManage: boolean }

export default function BillingSettingsForm({ clinics, settings, selectedClinicId }: {
  clinics: BillingClinicOption[]; settings: BillingSettingsRecord[]; selectedClinicId: string | null;
}) {
  const [clinicId, setClinicId] = useState(selectedClinicId ?? clinics[0]?.id ?? "");
  const [currentSettings, setCurrentSettings] = useState(settings);
  const clinic = clinics.find((item) => item.id === clinicId);
  const initial = currentSettings.find((item) => item.clinicId === clinicId);
  return <section className="rounded-2xl border border-line bg-canvas p-5 space-y-5">
    <div><h2 className="text-lg font-semibold text-ink">Clinic billing settings</h2>
      <p className="text-sm text-muted">Confirm GST treatment with your CA. MEDCARE PRO performs arithmetic only.</p></div>
    <Select id="billing-clinic" label="Clinic" value={clinicId} onChange={(event) => setClinicId(event.target.value)}>
      {clinics.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
    </Select>
    {clinic && initial ? <SettingsFields key={clinic.id} initial={initial} canManage={clinic.canManage}
      onSaved={(saved) => setCurrentSettings((current) => current.map((item) => item.clinicId === saved.clinicId ? saved : item))} />
      : <p className="text-sm text-muted">No clinic is available to your role.</p>}
  </section>;
}

function SettingsFields({ initial, canManage, onSaved }: { initial: BillingSettingsRecord; canManage: boolean; onSaved: (settings: BillingSettingsRecord) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true); setError(""); setSaved(false);
    try {
      const response = await fetch(`/api/billing/settings/${initial.clinicId}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.fromEntries(form)),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error ?? "Could not save settings.");
      onSaved(result.data);
      setSaved(true);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not save settings."); }
    finally { setBusy(false); }
  }
  return <form onSubmit={submit} onChange={() => setSaved(false)} className="space-y-4">
    {!canManage && <p className="text-sm text-muted">View only — your role cannot change billing settings.</p>}
    <fieldset disabled={!canManage || busy} className="grid gap-4 sm:grid-cols-2">
      <Input id="billing-gstin" name="gstin" label="GSTIN (optional)" maxLength={15} defaultValue={initial.gstin ?? ""} />
      <Input id="billing-legal-name" name="legalName" label="Legal / trade name (optional)" maxLength={200} defaultValue={initial.legalName ?? ""} hint="The clinic name is used when blank." />
      <Input id="billing-prefix" name="invoicePrefix" label="Invoice prefix" required pattern="[A-Z0-9]{1,4}" maxLength={4} defaultValue={initial.invoicePrefix} hint="1–4 uppercase letters or digits. Applies to future invoices." />
      <Input id="billing-discount" name="staffDiscountLimitPercent" label="Staff discount limit (%)" required type="number" min="0" max="100" step="0.01" defaultValue={initial.staffDiscountLimitPercent} />
      <div className="sm:col-span-2"><Textarea id="billing-footer" name="footerNote" label="Invoice footer (optional)" maxLength={500} defaultValue={initial.footerNote ?? ""} /></div>
    </fieldset>
    {error && <p role="alert" className="text-sm text-alert-ink">{error}</p>}
    {saved && <p role="status" className="text-sm text-muted">Billing settings saved.</p>}
    {canManage && <Button type="submit" isBusy={busy}>Save settings</Button>}
  </form>;
}
