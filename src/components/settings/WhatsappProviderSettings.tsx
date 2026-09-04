"use client";

import Image from "next/image";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import Button from "@/components/ui/Button";
import Input, { controlClasses, FieldShell } from "@/components/ui/Input";
import type { WhatsappConfigurationView } from "@/lib/whatsappProviderConfig";

export default function WhatsappProviderSettings({ initialValue, canEdit }: { initialValue: WhatsappConfigurationView; canEdit: boolean }) {
  const [value, setValue] = useState(initialValue);
  const [primary, setPrimary] = useState(initialValue.defaultDeviceId ?? "");
  const [backup, setBackup] = useState(initialValue.backupDeviceId ?? "");
  const [failover, setFailover] = useState(initialValue.automaticFailover);
  const [overrides, setOverrides] = useState<Record<string, string>>(Object.fromEntries(initialValue.clinics.map((clinic) => [clinic.id, clinic.deviceId ?? ""])));
  const [notice, setNotice] = useState<string | null>(null);
  const [connectOpen, setConnectOpen] = useState(false);
  const [qr, setQr] = useState<{ deviceId: string; value: string } | null>(null);

  const devices = useMemo(() => value.accounts.flatMap((account) => account.enabled ? account.devices.filter((device) => device.enabled).map((device) => ({ ...device, accountId: account.id })) : []), [value]);
  async function reload() {
    const response = await fetch("/api/settings/whatsapp", { cache: "no-store" });
    const payload = await response.json() as { success?: boolean; data?: WhatsappConfigurationView };
    if (payload.data) setValue(payload.data);
  }
  async function deviceAction(deviceId: string, action: string) {
    setNotice(null);
    const response = await fetch(`/api/settings/whatsapp/devices/${deviceId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
    const payload = await response.json() as { success?: boolean; data?: { webhookUrl?: string }; error?: string };
    if (!response.ok || !payload.success) throw new Error(payload.error ?? "Device action failed.");
    if (payload.data?.webhookUrl) setNotice(`Webhook URL (copy now): ${payload.data.webhookUrl}`);
    await reload();
  }
  async function saveRouting(event: FormEvent) {
    event.preventDefault(); setNotice(null);
    const response = await fetch("/api/settings/whatsapp", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "saveRouting", value: { defaultDeviceId: primary || null, backupDeviceId: backup || null, automaticFailover: failover, clinicOverrides: value.clinics.map((clinic) => ({ clinicId: clinic.id, deviceId: overrides[clinic.id] || null })) } }) });
    const payload = await response.json() as { success?: boolean; data?: WhatsappConfigurationView; error?: string };
    if (!response.ok || !payload.success || !payload.data) { setNotice(payload.error ?? "Could not save routing."); return; }
    setValue(payload.data); setNotice("WhatsApp routing saved.");
  }
  return (
    <div className="space-y-6">
      {notice && <div role="status" className="break-all rounded-xl border border-line bg-canvas-deep p-4 text-sm text-ink">{notice}</div>}
      <section className="rounded-2xl border border-line bg-canvas p-5 shadow-card">
        <div className="flex items-start justify-between gap-4"><div><h2 className="text-lg font-semibold text-ink">WhatsApp integration</h2><p className="text-sm text-muted">RkvRobo provider credentials are managed by MEDCARE PRO.</p></div>{canEdit && <Button onClick={() => { setQr(null); setConnectOpen(true); }}>Connect WhatsApp number</Button>}</div>
        {value.accounts.length === 0 ? <p className="mt-5 text-sm text-warn-ink">Provider not configured. Contact MEDCARE PRO support.</p> : value.accounts.map((account) => <div key={account.id} className="mt-5"><p className="text-sm font-semibold text-ink">{account.devices.filter((device) => device.enabled).length} of {account.deviceLimit} devices configured</p><div className="mt-3 space-y-3">{account.devices.map((device) => <DeviceRow key={device.id} device={device} canEdit={canEdit} primary={primary === device.id} backup={backup === device.id} act={async (action) => { try { await deviceAction(device.id, action); } catch (error) { setNotice(error instanceof Error ? error.message : "Device action failed."); } }} />)}</div></div>)}
      </section>
      <form onSubmit={saveRouting} className="space-y-5 rounded-2xl border border-line bg-canvas p-5 shadow-card">
        <h2 className="text-lg font-semibold text-ink">Primary, backup and clinic routing</h2>
        <div className="grid gap-4 md:grid-cols-2"><DeviceSelect id="primary-device" label="Primary WhatsApp device" value={primary} setValue={setPrimary} devices={devices} disabled={!canEdit} empty="Not configured" /><DeviceSelect id="backup-device" label="Backup WhatsApp device" value={backup} setValue={setBackup} devices={devices.filter((device) => device.id !== primary)} disabled={!canEdit} empty="No backup" /></div>
        <label className="flex items-center gap-2 text-sm font-medium text-ink"><input type="checkbox" checked={failover} onChange={(e) => setFailover(e.target.checked)} disabled={!canEdit || !backup} /> Automatic failover when primary is positively disconnected</label>
        <div className="grid gap-4 md:grid-cols-2">{value.clinics.map((clinic) => <DeviceSelect key={clinic.id} id={`clinic-${clinic.id}`} label={clinic.name} value={overrides[clinic.id] ?? ""} setValue={(next) => setOverrides((current) => ({ ...current, [clinic.id]: next }))} devices={devices} disabled={!canEdit} empty="Use organisation primary" />)}</div>
        {canEdit && <Button type="submit" variant="primary">Save routing</Button>}
      </form>
      {connectOpen && <ConnectModal accounts={value.accounts.filter((account) => account.enabled && account.devices.filter((device) => device.enabled).length < account.deviceLimit)} qr={qr} setQr={setQr} close={() => { setConnectOpen(false); setQr(null); void reload(); }} />}
    </div>
  );
}

function DeviceSelect({ id, label, value, setValue, devices, disabled, empty }: { id: string; label: string; value: string; setValue: (value: string) => void; devices: Array<{ id: string; name: string; phoneNumber: string; connectionStatus: string }>; disabled: boolean; empty: string }) {
  return <FieldShell id={id} label={label}><select id={id} className={controlClasses(false, "min-h-11 px-3.5")} value={value} onChange={(e) => setValue(e.target.value)} disabled={disabled}><option value="">{empty}</option>{devices.map((device) => <option key={device.id} value={device.id}>{device.name} · +{device.phoneNumber} · {device.connectionStatus.toLowerCase()}</option>)}</select></FieldShell>;
}

function DeviceRow({ device, canEdit, primary, backup, act }: { device: WhatsappConfigurationView["accounts"][number]["devices"][number]; canEdit: boolean; primary: boolean; backup: boolean; act: (action: string) => Promise<void> }) {
  return <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line p-4"><div><p className="font-semibold text-ink">{device.name} · +{device.phoneNumber}</p><p className="text-sm text-muted">{device.connectionStatus} {primary ? "· Organisation primary" : backup ? "· Backup" : ""}</p></div>{canEdit && <div className="flex flex-wrap gap-2"><Button size="sm" onClick={() => void act("refresh")}>Refresh status</Button><Button size="sm" onClick={() => { if (confirm("Disconnect this WhatsApp session?")) void act("disconnect"); }}>Disconnect</Button><Button size="sm" onClick={() => { if (confirm("Regenerate the webhook secret? The old URL will stop working.")) void act("regenerateWebhook"); }}>Webhook setup</Button><Button size="sm" variant="danger" onClick={() => { if (confirm("Remove this device from RkvRobo and MedCarePro?")) void act("remove"); }}>Remove</Button></div>}</div>;
}

function ConnectModal({ accounts, qr, setQr, close }: { accounts: WhatsappConfigurationView["accounts"]; qr: { deviceId: string; value: string } | null; setQr: (value: { deviceId: string; value: string } | null) => void; close: () => void }) {
  const [phoneNumber, setPhoneNumber] = useState(""); const [name, setName] = useState("Primary WhatsApp"); const [accountId, setAccountId] = useState(accounts[0]?.id ?? ""); const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  useEffect(() => { if (!qr) return; let attempts = 0; const timer = window.setInterval(async () => { attempts += 1; if (attempts > 30) { window.clearInterval(timer); setError("Status polling stopped after one minute. Refresh status manually."); return; } const response = await fetch(`/api/settings/whatsapp/devices/${qr.deviceId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "refresh" }) }); const payload = await response.json() as { data?: { connected?: boolean } }; if (payload.data?.connected) { window.clearInterval(timer); setError("Connected. You may close this window."); } }, 2000); return () => window.clearInterval(timer); }, [qr]);
  async function connect(event: FormEvent) { event.preventDefault(); setBusy(true); setError(null); try { const response = await fetch("/api/settings/whatsapp/devices/connect", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phoneNumber, name, ...(accounts.length > 1 ? { providerAccountId: accountId } : {}) }) }); const payload = await response.json() as { success?: boolean; data?: { deviceId: string; qr: string }; error?: string }; if (!response.ok || !payload.success || !payload.data) throw new Error(payload.error ?? "Could not generate QR."); setQr({ deviceId: payload.data.deviceId, value: payload.data.qr }); } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not generate QR."); } finally { setBusy(false); } }
  const source = qr ? (qr.value.startsWith("data:") ? qr.value : `data:image/png;base64,${qr.value}`) : null;
  return <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4"><div className="w-full max-w-md space-y-4 rounded-2xl bg-canvas p-6 shadow-xl"><div className="flex justify-between"><h2 className="text-lg font-semibold text-ink">{qr ? "Scan this QR using WhatsApp" : "Connect WhatsApp number"}</h2><button onClick={close} aria-label="Close">×</button></div>{error && <p role="status" className="text-sm text-warn-ink">{error}</p>}{source ? <div className="mx-auto h-72 w-72"><Image src={source} alt="WhatsApp connection QR code" width={288} height={288} unoptimized /></div> : <form onSubmit={connect} className="space-y-4"><Input id="connect-name" label="Device name" value={name} onChange={(e) => setName(e.target.value)} required /><Input id="connect-number" label="WhatsApp number with country code" value={phoneNumber} onChange={(e) => setPhoneNumber(e.target.value)} placeholder="919812345678" required />{accounts.length > 1 && <DeviceSelect id="provider-account" label="Provider account" value={accountId} setValue={setAccountId} devices={accounts.map((account) => ({ id: account.id, name: account.name, phoneNumber: `${account.devices.length}/${account.deviceLimit}`, connectionStatus: "slots" }))} disabled={false} empty="Choose account" />}<Button type="submit" variant="primary" isBusy={busy} busyLabel="Generating QR">Generate QR</Button></form>}</div></div>;
}
