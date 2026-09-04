"use client";

import { useState, type FormEvent } from "react";
import type { PlatformWhatsappAccountView } from "@/lib/platform/whatsappProvider";

export default function PlatformWhatsappAccounts({ tenantId, initialAccounts }: { tenantId: string; initialAccounts: PlatformWhatsappAccountView[] }) {
  const [accounts, setAccounts] = useState(initialAccounts);
  const [adding, setAdding] = useState(initialAccounts.length === 0);
  return (
    <div className="space-y-4">
      {accounts.map((account) => <AccountEditor key={account.id} tenantId={tenantId} account={account} onSaved={setAccounts} />)}
      {adding && <AccountEditor tenantId={tenantId} onSaved={(next) => { setAccounts(next); setAdding(false); }} />}
      {!adding && <button onClick={() => setAdding(true)} className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-2 text-sm font-semibold hover:border-indigo-500">Add provider account</button>}
    </div>
  );
}

function AccountEditor({ tenantId, account, onSaved }: { tenantId: string; account?: PlatformWhatsappAccountView; onSaved: (value: PlatformWhatsappAccountView[]) => void }) {
  const [name, setName] = useState(account?.name ?? "Primary RkvRobo");
  const [apiBaseUrl, setApiBaseUrl] = useState(account?.apiBaseUrl ?? "https://bot.rkvrobo.in/api");
  const [apiKey, setApiKey] = useState("");
  const [deviceLimit, setDeviceLimit] = useState(account?.deviceLimit ?? 2);
  const [enabled, setEnabled] = useState(account?.enabled ?? true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setMessage(null);
    try {
      const response = await fetch(`/api/owner/applications/${tenantId}/whatsapp`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...(account ? { accountId: account.id } : {}), name, apiBaseUrl, ...(apiKey ? { apiKey } : {}), deviceLimit, enabled }) });
      const payload = await response.json() as { success?: boolean; data?: PlatformWhatsappAccountView[]; error?: string };
      if (!response.ok || !payload.success || !payload.data) throw new Error(payload.error ?? "Could not save provider account.");
      onSaved(payload.data); setApiKey(""); setMessage("Provider account saved.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not save provider account."); }
    finally { setBusy(false); }
  }
  return (
    <form onSubmit={submit} className="space-y-4 rounded-2xl border border-slate-800 bg-[#0d1427] p-5">
      <div className="grid gap-4 md:grid-cols-2">
        <label className="text-xs text-slate-400">Account label<input className="mt-1 block w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-white" value={name} onChange={(e) => setName(e.target.value)} required /></label>
        <label className="text-xs text-slate-400">API base URL<input type="url" className="mt-1 block w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-white" value={apiBaseUrl} onChange={(e) => setApiBaseUrl(e.target.value)} required /></label>
        <label className="text-xs text-slate-400">{account ? "Replace API key" : "API key"}<input type="password" autoComplete="new-password" className="mt-1 block w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-white" value={apiKey} onChange={(e) => setApiKey(e.target.value)} required={!account} placeholder={account?.apiKeyConfigured ? "Configured — leave blank to keep" : "Enter API key"} /></label>
        <label className="text-xs text-slate-400">Device limit<input type="number" min={1} max={100} className="mt-1 block w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-white" value={deviceLimit} onChange={(e) => setDeviceLimit(Number(e.target.value))} required /></label>
      </div>
      <div className="flex flex-wrap items-center gap-4 text-sm"><span>API key: <strong>{account?.apiKeyConfigured ? "Configured" : "Not configured"}</strong></span><span>Devices: <strong>{account?.configuredDevices ?? 0} / {deviceLimit}</strong></span><label><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> Enabled</label></div>
      {message && <p role="status" className="text-sm text-amber-300">{message}</p>}
      <button disabled={busy} className="rounded-xl bg-indigo-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Saving…" : "Save provider account"}</button>
    </form>
  );
}
