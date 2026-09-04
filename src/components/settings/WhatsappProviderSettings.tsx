"use client";

import { useState, type FormEvent } from "react";
import { CheckCircle2, KeyRound, Plus, Router, Smartphone } from "lucide-react";
import Button from "@/components/ui/Button";
import Input, { controlClasses, FieldShell } from "@/components/ui/Input";
import type { WhatsappConfigurationView } from "@/lib/whatsappProviderConfig";

interface Props {
  initialValue: WhatsappConfigurationView;
  canEdit: boolean;
}

type Mutation =
  | { action: "saveAccount"; value: Record<string, unknown> }
  | { action: "saveDevice"; value: Record<string, unknown> }
  | { action: "saveRouting"; value: Record<string, unknown> };

async function mutate(input: Mutation): Promise<WhatsappConfigurationView> {
  const response = await fetch("/api/settings/whatsapp", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    success?: boolean;
    data?: WhatsappConfigurationView;
    error?: string;
  };
  if (!response.ok || !payload.success || !payload.data) {
    throw new Error(payload.error ?? "Could not save WhatsApp settings.");
  }
  return payload.data;
}

function Notice({ message, error }: { message: string | null; error?: boolean }) {
  if (!message) return null;
  return (
    <div
      role={error ? "alert" : "status"}
      className={
        error
          ? "rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700"
          : "rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700"
      }
    >
      {message}
    </div>
  );
}

function AccountForm({
  account,
  canEdit,
  onSaved,
}: {
  account?: WhatsappConfigurationView["accounts"][number];
  canEdit: boolean;
  onSaved: (value: WhatsappConfigurationView) => void;
}) {
  const [name, setName] = useState(account?.name ?? "Primary RkvRobo account");
  const [apiBaseUrl, setApiBaseUrl] = useState(
    account?.apiBaseUrl ?? "https://bot.rkvrobo.in/api",
  );
  const [apiKey, setApiKey] = useState("");
  const [enabled, setEnabled] = useState(account?.enabled ?? true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const value = await mutate({
        action: "saveAccount",
        value: {
          ...(account ? { accountId: account.id } : {}),
          name,
          apiBaseUrl,
          ...(apiKey.trim() ? { apiKey } : {}),
          enabled,
        },
      });
      setApiKey("");
      setFailed(false);
      setMessage(account ? "Provider account updated." : "Provider account added.");
      onSaved(value);
    } catch (error: unknown) {
      setFailed(true);
      setMessage(error instanceof Error ? error.message : "Could not save the account.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4 rounded-2xl border border-line bg-canvas p-5 shadow-card">
      <div className="flex items-center gap-3">
        <div className="rounded-xl bg-accent-soft p-2 text-accent"><KeyRound className="h-5 w-5" /></div>
        <div>
          <h3 className="font-semibold text-ink">{account?.name ?? "Add provider account"}</h3>
          <p className="text-sm text-muted">API credentials remain encrypted on the server.</p>
        </div>
      </div>
      <Notice message={message} error={failed} />
      <div className="grid gap-4 md:grid-cols-2">
        <Input id={`account-name-${account?.id ?? "new"}`} label="Account name" value={name} onChange={(e) => setName(e.target.value)} disabled={!canEdit} maxLength={100} />
        <Input id={`account-url-${account?.id ?? "new"}`} label="RkvRobo API base URL" value={apiBaseUrl} onChange={(e) => setApiBaseUrl(e.target.value)} disabled={!canEdit} type="url" />
      </div>
      <Input
        id={`account-key-${account?.id ?? "new"}`}
        label={account ? "Replace API key" : "API key"}
        type="password"
        autoComplete="new-password"
        value={apiKey}
        onChange={(e) => setApiKey(e.target.value)}
        disabled={!canEdit}
        required={!account}
        hint={account ? "Leave blank to keep the encrypted key already stored." : "Copied from RkvRobo Profile Settings."}
      />
      <label className="flex items-center gap-2 text-sm font-medium text-ink-soft">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} disabled={!canEdit} />
        Account active
      </label>
      {canEdit && <Button type="submit" variant="primary" isBusy={busy} busyLabel="Saving">{account ? "Save account" : "Add account"}</Button>}
    </form>
  );
}

function DeviceForm({
  accountId,
  device,
  canEdit,
  onSaved,
}: {
  accountId: string;
  device?: WhatsappConfigurationView["accounts"][number]["devices"][number];
  canEdit: boolean;
  onSaved: (value: WhatsappConfigurationView) => void;
}) {
  const [name, setName] = useState(device?.name ?? "");
  const [phoneNumber, setPhoneNumber] = useState(device?.phoneNumber ?? "");
  const [enabled, setEnabled] = useState(device?.enabled ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onSaved(await mutate({
        action: "saveDevice",
        value: {
          ...(device ? { deviceId: device.id } : {}),
          providerAccountId: accountId,
          name,
          phoneNumber,
          enabled,
        },
      }));
      if (!device) {
        setName("");
        setPhoneNumber("");
      }
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Could not save the device.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-3 rounded-xl border border-line bg-canvas-deep/40 p-4 md:grid-cols-[1fr_1fr_auto] md:items-end">
      <Input id={`device-name-${device?.id ?? accountId}`} label="Device name" placeholder="Primary WhatsApp" value={name} onChange={(e) => setName(e.target.value)} disabled={!canEdit} required />
      <Input id={`device-number-${device?.id ?? accountId}`} label="WhatsApp number" placeholder="919876543210" value={phoneNumber} onChange={(e) => setPhoneNumber(e.target.value)} disabled={!canEdit} required hint="Include country code. Rotate is never used." />
      <div className="flex items-center gap-3 pb-0.5">
        {device && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} disabled={!canEdit} />Active</label>}
        {canEdit && <Button type="submit" size="sm" isBusy={busy} busyLabel="Saving">{device ? "Save" : "Add device"}</Button>}
      </div>
      {error && <div role="alert" className="text-sm text-alert-ink md:col-span-3">{error}</div>}
    </form>
  );
}

export default function WhatsappProviderSettings({ initialValue, canEdit }: Props) {
  const [value, setValue] = useState(initialValue);
  const [showNewAccount, setShowNewAccount] = useState(initialValue.accounts.length === 0);
  const [defaultDeviceId, setDefaultDeviceId] = useState(value.defaultDeviceId ?? "");
  const [overrides, setOverrides] = useState<Record<string, string>>(
    Object.fromEntries(value.clinics.map((clinic) => [clinic.id, clinic.deviceId ?? ""])),
  );
  const [routingBusy, setRoutingBusy] = useState(false);
  const [routingMessage, setRoutingMessage] = useState<string | null>(null);
  const [routingFailed, setRoutingFailed] = useState(false);

  const activeDevices = value.accounts.flatMap((account) =>
    account.enabled
      ? account.devices.filter((device) => device.enabled).map((device) => ({
          ...device,
          label: `${device.name} · ${device.phoneNumber} (${account.name})`,
        }))
      : [],
  );

  function accept(next: WhatsappConfigurationView) {
    setValue(next);
    setDefaultDeviceId(next.defaultDeviceId ?? "");
    setOverrides(Object.fromEntries(next.clinics.map((clinic) => [clinic.id, clinic.deviceId ?? ""])));
    setShowNewAccount(false);
  }

  async function saveRouting(event: FormEvent) {
    event.preventDefault();
    setRoutingBusy(true);
    setRoutingMessage(null);
    try {
      accept(await mutate({
        action: "saveRouting",
        value: {
          defaultDeviceId: defaultDeviceId || null,
          clinicOverrides: value.clinics.map((clinic) => ({
            clinicId: clinic.id,
            deviceId: overrides[clinic.id] || null,
          })),
        },
      }));
      setRoutingFailed(false);
      setRoutingMessage("WhatsApp routing saved.");
    } catch (error: unknown) {
      setRoutingFailed(true);
      setRoutingMessage(error instanceof Error ? error.message : "Could not save routing.");
    } finally {
      setRoutingBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      {!canEdit && <div className="rounded-xl border border-line bg-canvas-deep px-4 py-3 text-sm text-muted">You can view this configuration. Settings management permission is required to change it.</div>}

      <section className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div><h2 className="text-lg font-semibold text-ink">Provider accounts</h2><p className="text-sm text-muted">Normally one per organisation; additional accounts remain supported.</p></div>
          {canEdit && value.accounts.length > 0 && <Button size="sm" onClick={() => setShowNewAccount((shown) => !shown)}><Plus className="h-4 w-4" />Add account</Button>}
        </div>
        {value.accounts.map((account) => (
          <div key={account.id} className="space-y-3">
            <AccountForm account={account} canEdit={canEdit} onSaved={accept} />
            <div className="ml-0 space-y-3 border-l-2 border-line pl-4 md:ml-6">
              <div className="flex items-center gap-2 text-sm font-semibold text-ink"><Smartphone className="h-4 w-4" />Devices</div>
              {account.devices.map((device) => <DeviceForm key={device.id} accountId={account.id} device={device} canEdit={canEdit} onSaved={accept} />)}
              {canEdit && <DeviceForm accountId={account.id} canEdit={canEdit} onSaved={accept} />}
            </div>
          </div>
        ))}
        {showNewAccount && canEdit && <AccountForm canEdit={canEdit} onSaved={accept} />}
      </section>

      <form onSubmit={saveRouting} className="space-y-5 rounded-2xl border border-line bg-canvas p-5 shadow-card">
        <div className="flex items-center gap-3"><div className="rounded-xl bg-accent-soft p-2 text-accent"><Router className="h-5 w-5" /></div><div><h2 className="text-lg font-semibold text-ink">Device routing</h2><p className="text-sm text-muted">A clinic override wins; otherwise the organisation default is used.</p></div></div>
        <Notice message={routingMessage} error={routingFailed} />
        <FieldShell id="default-whatsapp-device" label="Organisation default device" hint="Used by every clinic without an override.">
          <select id="default-whatsapp-device" className={controlClasses(false, "min-h-11 px-3.5")} value={defaultDeviceId} onChange={(e) => setDefaultDeviceId(e.target.value)} disabled={!canEdit}>
            <option value="">Not configured</option>
            {activeDevices.map((device) => <option key={device.id} value={device.id}>{device.label}</option>)}
          </select>
        </FieldShell>
        <div className="grid gap-4 md:grid-cols-2">
          {value.clinics.map((clinic) => (
            <FieldShell key={clinic.id} id={`clinic-device-${clinic.id}`} label={clinic.name} hint="Inherit uses the organisation default.">
              <select id={`clinic-device-${clinic.id}`} className={controlClasses(false, "min-h-11 px-3.5")} value={overrides[clinic.id] ?? ""} onChange={(e) => setOverrides((current) => ({ ...current, [clinic.id]: e.target.value }))} disabled={!canEdit}>
                <option value="">Inherit organisation default</option>
                {activeDevices.map((device) => <option key={device.id} value={device.id}>{device.label}</option>)}
              </select>
            </FieldShell>
          ))}
        </div>
        {canEdit && <Button type="submit" variant="primary" isBusy={routingBusy} busyLabel="Saving routing"><CheckCircle2 className="h-4 w-4" />Save routing</Button>}
      </form>
    </div>
  );
}
