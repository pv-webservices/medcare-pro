"use client";

import Image from "next/image";
import { X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import Button from "@/components/ui/Button";
import Input, { controlClasses, FieldShell } from "@/components/ui/Input";
import StatusPill, { type StatusTone } from "@/components/ui/StatusPill";
import type { WhatsappConfigurationView } from "@/lib/whatsappProviderConfig";

type Device = WhatsappConfigurationView["accounts"][number]["devices"][number];
type ActionData = {
  connected?: boolean;
  alreadyConnected?: boolean;
  deviceId?: string;
  qr?: string | null;
  message?: string;
  webhookUrl?: string | null;
  references?: RemoveReferences;
  replacements?: Array<Pick<Device, "id" | "name" | "phoneNumber" | "connectionStatus">>;
};
type RemoveReferences = {
  organisationPrimary: boolean;
  organisationBackup: boolean;
  clinics: Array<{ id: string; name: string }>;
};
type RemoveTarget = {
  device: Device;
  references: RemoveReferences;
  replacements: Array<Pick<Device, "id" | "name" | "phoneNumber" | "connectionStatus">>;
};

export default function WhatsappProviderSettings({ initialValue, canEdit }: { initialValue: WhatsappConfigurationView; canEdit: boolean }) {
  const [value, setValue] = useState(initialValue);
  const [primary, setPrimary] = useState(initialValue.defaultDeviceId ?? "");
  const [backup, setBackup] = useState(initialValue.backupDeviceId ?? "");
  const [failover, setFailover] = useState(initialValue.automaticFailover);
  const [overrides, setOverrides] = useState<Record<string, string>>(Object.fromEntries(initialValue.clinics.map((clinic) => [clinic.id, clinic.deviceId ?? ""])));
  const [notice, setNotice] = useState<string | null>(null);
  const [webhookUrl, setWebhookUrl] = useState<string | null>(null);
  const [connectOpen, setConnectOpen] = useState(false);
  const [qr, setQr] = useState<{ deviceId: string; value: string; reconnect: boolean } | null>(null);
  const [removeTarget, setRemoveTarget] = useState<RemoveTarget | null>(null);

  const devices = useMemo(() => value.accounts.flatMap((account) => account.enabled ? account.devices.filter((device) => device.enabled).map((device) => ({ ...device, accountId: account.id })) : []), [value]);
  const availableAccounts = useMemo(() => value.accounts.filter((account) => account.enabled && account.devices.length < account.deviceLimit), [value.accounts]);

  function applyValue(next: WhatsappConfigurationView) {
    setValue(next);
    setPrimary(next.defaultDeviceId ?? "");
    setBackup(next.backupDeviceId ?? "");
    setFailover(next.automaticFailover);
    setOverrides(Object.fromEntries(next.clinics.map((clinic) => [clinic.id, clinic.deviceId ?? ""])));
  }

  async function reload() {
    const response = await fetch("/api/settings/whatsapp", { cache: "no-store" });
    const payload = await response.json() as { success?: boolean; data?: WhatsappConfigurationView };
    if (payload.data) applyValue(payload.data);
  }

  async function deviceAction(deviceId: string, body: Record<string, unknown>): Promise<ActionData> {
    setNotice(null);
    setWebhookUrl(null);
    const response = await fetch(`/api/settings/whatsapp/devices/${deviceId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const payload = await response.json() as { success?: boolean; data?: ActionData; error?: string };
    if (!response.ok || !payload.success) throw new Error(payload.error ?? "Device action failed.");
    if (payload.data?.webhookUrl) {
      setWebhookUrl(payload.data.webhookUrl);
      setNotice("Paste this URL into the Webhook URL field for this exact device in RkvRobo. The secret cannot be displayed again.");
    } else if (payload.data?.message) setNotice(payload.data.message);
    await reload();
    return payload.data ?? {};
  }

  async function reconnect(device: Device) {
    try {
      const data = await deviceAction(device.id, { action: "reconnect" });
      if (data.alreadyConnected) {
        setNotice(data.message ?? "WhatsApp is already connected.");
      } else if (data.qr && data.deviceId) {
        setQr({ deviceId: data.deviceId, value: data.qr, reconnect: true });
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not reconnect WhatsApp.");
    }
  }

  async function openRemove(device: Device) {
    try {
      const data = await deviceAction(device.id, { action: "removeReferences" });
      if (!data.references || !data.replacements) throw new Error("Could not inspect device routing.");
      setRemoveTarget({ device, references: data.references, replacements: data.replacements });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not inspect device routing.");
    }
  }

  async function saveRouting(event: FormEvent) {
    event.preventDefault(); setNotice(null);
    const response = await fetch("/api/settings/whatsapp", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "saveRouting", value: { defaultDeviceId: primary || null, backupDeviceId: backup || null, automaticFailover: failover, clinicOverrides: value.clinics.map((clinic) => ({ clinicId: clinic.id, deviceId: overrides[clinic.id] || null })) } }) });
    const payload = await response.json() as { success?: boolean; data?: WhatsappConfigurationView; error?: string };
    if (!response.ok || !payload.success || !payload.data) { setNotice(payload.error ?? "Could not save routing."); return; }
    applyValue(payload.data); setNotice("WhatsApp routing saved.");
  }

  return (
    <div className="space-y-6">
      {notice && <div role="status" className="break-all rounded-xl border border-line bg-canvas-deep p-4 text-sm text-ink">{notice}</div>}
      {webhookUrl && <div className="space-y-3 rounded-xl border border-line bg-canvas-deep p-4"><p className="text-sm font-semibold text-ink">Webhook URL</p><code className="block break-all text-xs text-ink">{webhookUrl}</code><Button size="sm" onClick={() => void navigator.clipboard.writeText(webhookUrl)}>Copy</Button></div>}
      <section className="rounded-2xl border border-line bg-canvas p-5 shadow-card">
        <div className="flex items-start justify-between gap-4"><div><h2 className="text-lg font-semibold text-ink">WhatsApp integration</h2><p className="text-sm text-muted">RkvRobo provider credentials are managed by MEDCARE PRO.</p></div>{canEdit && <Button disabled={availableAccounts.length === 0} onClick={() => { setQr(null); setConnectOpen(true); }}>Connect WhatsApp number</Button>}</div>
        {value.accounts.length === 0 ? <p className="mt-5 text-sm text-warn-ink">Provider not configured. Contact MEDCARE PRO support.</p> : value.accounts.map((account) => <div key={account.id} className="mt-5"><p className="text-sm font-semibold text-ink">{account.devices.length} of {account.deviceLimit} device slots are in use.</p><p className="mt-1 text-xs text-muted">A slot remains occupied after disconnecting or disabling a device and is freed only after Remove succeeds.</p><div className="mt-3 space-y-3">{account.devices.map((device) => <DeviceRow key={device.id} device={device} canEdit={canEdit} primary={primary === device.id} backup={backup === device.id} act={async (action) => { try { await deviceAction(device.id, { action }); } catch (error) { setNotice(error instanceof Error ? error.message : "Device action failed."); } }} reconnect={() => void reconnect(device)} remove={() => void openRemove(device)} />)}</div></div>)}
      </section>
      <form onSubmit={saveRouting} className="space-y-5 rounded-2xl border border-line bg-canvas p-5 shadow-card">
        <h2 className="text-lg font-semibold text-ink">Primary, backup and clinic routing</h2>
        <div className="grid gap-4 md:grid-cols-2"><DeviceSelect id="primary-device" label="Primary WhatsApp device" value={primary} setValue={setPrimary} devices={devices} disabled={!canEdit} empty="Not configured" /><DeviceSelect id="backup-device" label="Backup WhatsApp device" value={backup} setValue={setBackup} devices={devices.filter((device) => device.id !== primary)} disabled={!canEdit} empty="No backup" /></div>
        <label className="flex items-center gap-2 text-sm font-medium text-ink"><input type="checkbox" checked={failover} onChange={(event) => setFailover(event.target.checked)} disabled={!canEdit || !backup} /> Automatic failover when primary is positively disconnected</label>
        <div className="grid gap-4 md:grid-cols-2">{value.clinics.map((clinic) => <DeviceSelect key={clinic.id} id={`clinic-${clinic.id}`} label={clinic.name} value={overrides[clinic.id] ?? ""} setValue={(next) => setOverrides((current) => ({ ...current, [clinic.id]: next }))} devices={devices} disabled={!canEdit} empty="Use organisation primary" />)}</div>
        {canEdit && <Button type="submit" variant="primary">Save routing</Button>}
      </form>
      {connectOpen && <ConnectModal accounts={availableAccounts} qr={qr?.reconnect ? null : qr} setQr={(next) => setQr(next ? { ...next, reconnect: false } : null)} close={() => { setConnectOpen(false); setQr(null); void reload(); }} connected={(message) => { setNotice(message); setConnectOpen(false); setQr(null); void reload(); }} />}
      {qr?.reconnect && <QrModal title="Reconnect WhatsApp" qr={qr} close={() => { setQr(null); void reload(); }} connected={(message) => { setNotice(message); setQr(null); void reload(); }} />}
      {removeTarget && <RemoveDeviceModal target={removeTarget} close={() => setRemoveTarget(null)} remove={async (routingAction, replacementDeviceId) => { await deviceAction(removeTarget.device.id, { action: "remove", routingAction, ...(replacementDeviceId ? { replacementDeviceId } : {}) }); setRemoveTarget(null); setNotice("WhatsApp device removed."); }} />}
    </div>
  );
}

function DeviceSelect({ id, label, value, setValue, devices, disabled, empty }: { id: string; label: string; value: string; setValue: (value: string) => void; devices: Array<{ id: string; name: string; phoneNumber: string; connectionStatus: string }>; disabled: boolean; empty: string }) {
  return <FieldShell id={id} label={label}><select id={id} className={controlClasses(false, "min-h-11 px-3.5")} value={value} onChange={(event) => setValue(event.target.value)} disabled={disabled}><option value="">{empty}</option>{devices.map((device) => <option key={device.id} value={device.id}>{device.name} · +{device.phoneNumber} · {device.connectionStatus.toLowerCase()}</option>)}</select></FieldShell>;
}

function DeviceRow({ device, canEdit, primary, backup, act, reconnect, remove }: { device: Device; canEdit: boolean; primary: boolean; backup: boolean; act: (action: string) => Promise<void>; reconnect: () => void; remove: () => void }) {
  const status: Record<Device["connectionStatus"], { tone: StatusTone; help: string; label: string }> = {
    CONNECTED: { tone: "ok", help: "WhatsApp connection confirmed.", label: "CONNECTED" },
    DISCONNECTED: { tone: "alert", help: "The provider device exists but WhatsApp is disconnected.", label: "DISCONNECTED" },
    UNKNOWN: { tone: "neutral", help: "RkvRobo could not confirm this device's state.", label: "UNKNOWN" },
    PENDING: { tone: "warn", help: "A confirmed QR session is waiting to be scanned.", label: "PENDING" },
    MISSING: { tone: "alert", help: "The configured provider account reports that this device does not exist.", label: "Not found in RkvRobo" },
  };
  const state = status[device.connectionStatus];
  const checked = device.lastStatusCheckedAt ? new Date(device.lastStatusCheckedAt).toLocaleString() : "Never";
  const canReconnect = ["DISCONNECTED", "MISSING", "UNKNOWN", "PENDING"].includes(device.connectionStatus);
  return <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line p-4"><div className="space-y-1"><p className="font-semibold text-ink">{device.name} · +{device.phoneNumber}</p><div className="flex flex-wrap items-center gap-2"><StatusPill tone={state.tone}>{state.label}</StatusPill><span className="text-sm text-muted">{primary ? "Organisation primary" : backup ? "Organisation backup" : ""}</span></div><p className="text-xs text-muted">{state.help} Last checked: {checked}.</p><p className="text-xs text-muted">{device.webhookConfigured ? "Webhook configured." : "Webhook not configured."}</p></div>{canEdit && <div className="flex flex-wrap gap-2"><Button size="sm" onClick={() => void act("refresh")}>Refresh status</Button>{canReconnect && <Button size="sm" onClick={reconnect}>{device.connectionStatus === "MISSING" ? "Reconnect as this device" : device.connectionStatus === "PENDING" ? "Show/renew connection QR" : "Reconnect"}</Button>}{device.connectionStatus === "CONNECTED" && <Button size="sm" onClick={() => { if (confirm("Disconnect this WhatsApp session? The device remains configured and continues to occupy a provider slot.")) void act("disconnect"); }}>Disconnect</Button>}{device.webhookConfigured ? <Button size="sm" onClick={() => { if (confirm("Regenerate the webhook URL? The existing URL will immediately stop working.")) void act("regenerateWebhook"); }}>Regenerate webhook URL</Button> : <Button size="sm" onClick={() => void act("setupWebhook")}>Set up webhook</Button>}<Button size="sm" variant="danger" onClick={remove}>{device.connectionStatus === "MISSING" ? "Remove from MedCarePro" : "Remove"}</Button></div>}</div>;
}

function ModalShell({ title, close, children }: { title: string; close: () => void; children: ReactNode }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { close(); return; }
      if (event.key !== "Tab") return;
      const focusable = [...(panelRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), a[href]') ?? [])];
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [close]);
  return <div role="dialog" aria-modal="true" aria-labelledby="whatsapp-modal-title" className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4"><div ref={panelRef} className="w-full max-w-md space-y-4 rounded-2xl bg-canvas p-6 shadow-xl"><div className="flex items-start justify-between gap-4"><h2 id="whatsapp-modal-title" className="text-lg font-semibold text-ink">{title}</h2><button ref={closeRef} type="button" onClick={close} aria-label="Close" className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-line bg-canvas text-ink shadow-card hover:bg-canvas-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"><X aria-hidden="true" className="h-5 w-5" /></button></div>{children}</div></div>;
}

function useQrPolling(deviceId: string, connected: (message: string) => void, setError: (message: string) => void) {
  useEffect(() => {
    let attempts = 0;
    const timer = window.setInterval(async () => {
      attempts += 1;
      if (attempts > 30) { window.clearInterval(timer); setError("Status polling stopped after one minute. Refresh status manually."); return; }
      const response = await fetch(`/api/settings/whatsapp/devices/${deviceId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "refresh" }) });
      const payload = await response.json() as { data?: { connected?: boolean } };
      if (payload.data?.connected) { window.clearInterval(timer); connected("WhatsApp connected successfully."); }
    }, 2000);
    return () => window.clearInterval(timer);
  }, [connected, deviceId, setError]);
}

function QrImage({ value }: { value: string }) {
  const source = value.startsWith("data:") ? value : `data:image/png;base64,${value}`;
  return <div className="mx-auto h-72 w-72"><Image src={source} alt="WhatsApp connection QR code" width={288} height={288} unoptimized /></div>;
}

function QrModal({ title, qr, close, connected }: { title: string; qr: { deviceId: string; value: string }; close: () => void; connected: (message: string) => void }) {
  const [error, setError] = useState<string | null>(null);
  useQrPolling(qr.deviceId, connected, setError);
  return <ModalShell title={title} close={close}><p className="text-sm text-muted">Scan this QR using WhatsApp</p>{error && <p role="status" className="text-sm text-warn-ink">{error}</p>}<QrImage value={qr.value} /></ModalShell>;
}

function ConnectModal({ accounts, qr, setQr, close, connected }: { accounts: WhatsappConfigurationView["accounts"]; qr: { deviceId: string; value: string } | null; setQr: (value: { deviceId: string; value: string } | null) => void; close: () => void; connected: (message: string) => void }) {
  const [phoneNumber, setPhoneNumber] = useState(""); const [name, setName] = useState("Primary WhatsApp"); const [accountId, setAccountId] = useState(accounts[0]?.id ?? ""); const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  async function connect(event: FormEvent) { event.preventDefault(); setBusy(true); setError(null); try { const response = await fetch("/api/settings/whatsapp/devices/connect", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phoneNumber, name, ...(accounts.length > 1 ? { providerAccountId: accountId } : {}) }) }); const payload = await response.json() as { success?: boolean; data?: { deviceId: string; qr: string | null; alreadyConnected: boolean; message: string }; error?: string }; if (!response.ok || !payload.success || !payload.data) throw new Error(payload.error ?? "Could not connect WhatsApp."); if (payload.data.alreadyConnected) { connected(payload.data.message); return; } if (!payload.data.qr) throw new Error("RkvRobo did not return a QR code. The device was not marked as connecting."); setQr({ deviceId: payload.data.deviceId, value: payload.data.qr }); } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not connect WhatsApp."); } finally { setBusy(false); } }
  return qr ? <QrModal title="Connect WhatsApp number" qr={qr} close={close} connected={connected} /> : <ModalShell title="Connect WhatsApp number" close={close}>{error && <p role="status" className="text-sm text-warn-ink">{error}</p>}<form onSubmit={connect} className="space-y-4"><Input id="connect-name" label="Device name" value={name} onChange={(event) => setName(event.target.value)} required /><Input id="connect-number" label="WhatsApp number with country code" value={phoneNumber} onChange={(event) => setPhoneNumber(event.target.value)} placeholder="919812345678" required />{accounts.length > 1 && <DeviceSelect id="provider-account" label="Provider account" value={accountId} setValue={setAccountId} devices={accounts.map((account) => ({ id: account.id, name: account.name, phoneNumber: `${account.devices.length}/${account.deviceLimit}`, connectionStatus: "slots" }))} disabled={false} empty="Choose account" />}<Button type="submit" variant="primary" isBusy={busy} busyLabel="Connecting WhatsApp">Connect WhatsApp</Button></form></ModalShell>;
}

function RemoveDeviceModal({ target, close, remove }: { target: RemoveTarget; close: () => void; remove: (routingAction: "preserve" | "clear" | "reassign", replacementDeviceId?: string) => Promise<void> }) {
  const hasReferences = target.references.organisationPrimary || target.references.organisationBackup || target.references.clinics.length > 0;
  const [routingAction, setRoutingAction] = useState<"clear" | "reassign">(target.replacements.length > 0 ? "reassign" : "clear");
  const [replacementId, setReplacementId] = useState(target.replacements[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit() { setBusy(true); setError(null); try { await remove(hasReferences ? routingAction : "preserve", routingAction === "reassign" ? replacementId : undefined); } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not remove the device."); } finally { setBusy(false); } }
  return <ModalShell title="Remove WhatsApp device" close={close}><p className="font-semibold text-ink">+{target.device.phoneNumber}</p>{hasReferences && <div className="space-y-2"><p className="text-sm text-muted">This device is currently used by:</p><ul className="list-disc space-y-1 pl-5 text-sm text-ink">{target.references.organisationPrimary && <li>Organisation primary</li>}{target.references.organisationBackup && <li>Organisation backup</li>}{target.references.clinics.map((clinic) => <li key={clinic.id}>{clinic.name}</li>)}</ul><label className="flex items-start gap-2 text-sm text-ink"><input type="radio" name="remove-routing" checked={routingAction === "reassign"} onChange={() => setRoutingAction("reassign")} disabled={target.replacements.length === 0} /> <span>Reassign routing to another eligible device</span></label>{routingAction === "reassign" && <select aria-label="Replacement WhatsApp device" className={controlClasses(false, "min-h-11 px-3.5")} value={replacementId} onChange={(event) => setReplacementId(event.target.value)}>{target.replacements.map((device) => <option key={device.id} value={device.id}>{device.name} · +{device.phoneNumber}</option>)}</select>}<label className="flex items-start gap-2 text-sm text-ink"><input type="radio" name="remove-routing" checked={routingAction === "clear"} onChange={() => setRoutingAction("clear")} /> <span>Clear these assignments and let clinics inherit organisation routing</span></label></div>}<p className="text-sm text-alert-ink">This explicitly removes the provider device when present, updates routing, and removes the local device record.</p>{error && <p role="alert" className="text-sm text-alert-ink">{error}</p>}<div className="flex justify-end gap-2"><Button onClick={close} disabled={busy}>Cancel</Button><Button variant="dangerSolid" isBusy={busy} busyLabel="Removing device" onClick={() => void submit()}>Remove device</Button></div></ModalShell>;
}
