"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { PatientMatch } from "@/lib/registrations";
import { renderTemplate } from "@/lib/whatsappTemplateText";
import type { TemplateRecord } from "@/lib/whatsappTemplates";
import type { RecipientResult, SendMessageResult } from "@/lib/whatsappMessages";
import Button from "@/components/ui/Button";
import Input, { Select } from "@/components/ui/Input";
import Card from "@/components/ui/Card";

/**
 * Sending an approved template to patients — PRD §6.9 (FR-9.1).
 *
 * Recipients are chosen as PATIENTS, never as typed phone numbers: the number
 * is read from the patient record on the server, so this screen cannot be used
 * to message an arbitrary phone from the clinic's WhatsApp device.
 *
 * The preview runs the same `renderTemplate` the server does, so what is shown
 * is what goes out. Fields that come from the patient's latest visit — doctor,
 * department, date, amount — are not in the lookup result, so the preview says
 * they are filled per patient at send time rather than inventing them.
 */

interface MessageComposerProps {
  templates: readonly TemplateRecord[];
  clinicId: string | null;
  clinicName: string | null;
  isConfigured: boolean;
}

const SEARCH_DEBOUNCE_MS = 300;
const MAX_RECIPIENTS = 50;

export default function MessageComposer({
  templates,
  clinicId,
  clinicName,
  isConfigured,
}: MessageComposerProps) {
  const router = useRouter();
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const [search, setSearch] = useState("");
  const [matches, setMatches] = useState<PatientMatch[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [recipients, setRecipients] = useState<PatientMatch[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [outcome, setOutcome] = useState<SendMessageResult | null>(null);

  const template = templates.find((entry) => entry.id === templateId) ?? null;

  useEffect(() => {
    const term = search.trim();

    // Debounced: the front desk types a name, not one request per keystroke.
    // The too-short case is handled inside the timer rather than in the effect
    // body, so nothing sets state synchronously during the effect.
    const handle = setTimeout(async () => {
      if (!clinicId || term.length < 2) {
        setMatches([]);
        return;
      }

      setIsSearching(true);
      try {
        const response = await fetch(
          `/api/patients?clinicId=${encodeURIComponent(clinicId)}&search=${encodeURIComponent(term)}`,
        );
        const payload: { success?: boolean; data?: PatientMatch[] } = await response
          .json()
          .catch(() => ({}));
        setMatches(payload.success ? (payload.data ?? []) : []);
      } catch {
        setMatches([]);
      } finally {
        setIsSearching(false);
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(handle);
  }, [search, clinicId]);

  function addRecipient(patient: PatientMatch) {
    setOutcome(null);
    setRecipients((current) =>
      current.some((entry) => entry.id === patient.id)
        ? current
        : [...current, patient],
    );
    setSearch("");
    setMatches([]);
  }

  function removeRecipient(patientId: string) {
    setOutcome(null);
    setRecipients((current) => current.filter((entry) => entry.id !== patientId));
  }

  async function handleSend() {
    if (!template || recipients.length === 0) return;

    setError(null);
    setOutcome(null);
    setIsSending(true);
    try {
      const response = await fetch("/api/whatsapp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          templateId: template.id,
          patientIds: recipients.map((entry) => entry.id),
        }),
      });
      const payload: { success?: boolean; error?: string; data?: SendMessageResult } =
        await response.json().catch(() => ({}));

      if (!response.ok || !payload.success || !payload.data) {
        setError(payload.error ?? "Could not send. Try again.");
        return;
      }

      setOutcome(payload.data);
      setRecipients([]);
      // Brings the history table below up to date with what just went out.
      router.refresh();
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setIsSending(false);
    }
  }

  // Previewed against the first recipient, so the wording is checked against a
  // real name rather than a sample one.
  const previewFor = recipients[0];
  const preview = template
    ? renderTemplate(template.body, {
        patientName: previewFor?.name,
        patientCode: previewFor?.patientCode,
        clinicName: clinicName ?? undefined,
      })
    : "";

  if (!clinicId) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white px-6 py-8 text-center shadow-sm">
        <p className="text-sm font-medium text-slate-500">
          Pick a clinic in the sidebar to message its patients.
        </p>
      </div>
    );
  }

  return (
    <Card className="p-4 sm:p-6 space-y-6">
      {!isConfigured && (
        <p
          role="alert"
          className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-700"
        >
          WhatsApp is not connected yet. Set WHATSAPP_BSP_API_KEY in the
          environment before sending.
        </p>
      )}

      {error && (
        <p
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600"
        >
          {error}
        </p>
      )}

      {outcome && <SendOutcome outcome={outcome} />}

      <div className="max-w-md">
        <Select
          id="composer-template"
          name="templateId"
          label="Template"
          value={templateId}
          onChange={(event) => {
            setTemplateId(event.target.value);
            setOutcome(null);
          }}
        >
          {templates.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name}
            </option>
          ))}
        </Select>
      </div>

      <div className="max-w-md">
        <Input
          id="composer-search"
          name="search"
          label="Add patients"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search by name, mobile number or Patient ID"
          hint={isSearching
            ? "Searching…"
            : `Patients at ${clinicName ?? "this clinic"}. Up to ${MAX_RECIPIENTS} per send.`}
        />

        {search.trim().length >= 2 && matches.length > 0 && (
          <ul className="mt-2 grid gap-1 rounded-md border border-slate-200 bg-white p-1 shadow-sm max-h-64 overflow-y-auto">
            {matches.map((patient) => (
              <li key={patient.id}>
                <button
                  type="button"
                  onClick={() => addRecipient(patient)}
                  className="flex min-h-11 w-full items-center justify-between gap-3 rounded-md px-3 text-left text-sm hover:bg-slate-50 transition-colors"
                >
                  <span>
                    <span className="font-medium text-slate-900">{patient.name}</span>{" "}
                    <span className="text-slate-500">
                      {patient.patientCode}
                    </span>
                  </span>
                  <span className="tabular-nums text-slate-500">
                    {patient.mobileNumber}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {recipients.length > 0 && (
        <div>
          <p className="mb-2 text-sm font-semibold text-slate-900">
            Sending to {recipients.length}{" "}
            {recipients.length === 1 ? "patient" : "patients"}
          </p>
          <ul className="flex flex-wrap gap-2">
            {recipients.map((patient) => (
              <li
                key={patient.id}
                className="flex items-center gap-2 rounded-lg border border-slate-200 py-1.5 pl-3 pr-1.5 bg-slate-50"
              >
                <span className="text-sm font-medium text-slate-900">
                  {patient.name}{" "}
                  <span className="text-slate-500 font-normal">
                    {patient.patientCode}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => removeRecipient(patient.id)}
                  aria-label={`Remove ${patient.name}`}
                  className="min-h-8 rounded-md px-2 text-xs font-medium text-slate-500 hover:bg-slate-200 disabled:opacity-50 transition-colors"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {template && (
        <div>
          <p className="mb-2 text-sm font-semibold text-slate-900">Preview</p>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            {template.mediaType && (
              <p className="mb-3 text-xs font-medium text-slate-500">
                With {template.mediaType} attachment
              </p>
            )}
            <p className="whitespace-pre-wrap text-sm text-slate-900">{preview}</p>
            {template.footer && (
              <p className="mt-3 text-xs text-slate-500">
                {template.footer}
              </p>
            )}
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Doctor, department, visit date and amount are filled from each
            patient&apos;s most recent visit when the message is sent.
          </p>
        </div>
      )}

      <div>
        <Button
          type="button"
          onClick={handleSend}
          disabled={!template || recipients.length === 0 || isSending || !isConfigured}
          variant="commit"
          isBusy={isSending}
          busyLabel={`Sending to ${recipients.length}…`}
        >
          {recipients.length === 0
            ? "Send WhatsApp"
            : `Send WhatsApp to ${recipients.length}`}
        </Button>
      </div>
    </Card>
  );
}

/**
 * Per-recipient outcome. A partial send is normal — one wrong number must not
 * hide the eleven that went out — so every row is listed with its own reason.
 */
function SendOutcome({ outcome }: { outcome: SendMessageResult }) {
  const failures = outcome.results.filter(
    (result: RecipientResult) => result.status === "failed",
  );

  return (
    <div
      role="status"
      className={`rounded-xl border px-4 py-3 text-sm font-medium ${
        failures.length === 0
          ? "border-emerald-200 bg-emerald-50 text-emerald-800"
          : "border-amber-200 bg-amber-50 text-amber-800"
      }`}
    >
      <p>
        {outcome.sent} sent
        {outcome.failed > 0 && `, ${outcome.failed} failed`} — {outcome.templateName}
      </p>
      {failures.length > 0 && (
        <ul className="mt-2 grid gap-1 text-xs">
          {failures.map((result) => (
            <li key={result.patientId}>
              {result.patientName} ({result.patientCode}): {result.failureReason}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
