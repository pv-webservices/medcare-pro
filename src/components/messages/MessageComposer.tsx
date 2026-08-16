"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { PatientMatch } from "@/lib/registrations";
import { renderTemplate } from "@/lib/whatsappTemplateText";
import type { TemplateRecord } from "@/lib/whatsappTemplates";
import type { RecipientResult, SendMessageResult } from "@/lib/whatsappMessages";

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

const INPUT_CLASS =
  "block min-h-11 w-full rounded border border-black/20 bg-transparent px-3 text-base outline-none focus:border-black/60 dark:border-white/25 dark:focus:border-white/60";

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
      <p className="rounded border border-black/15 px-4 py-6 text-center text-sm text-black/60 dark:border-white/20 dark:text-white/60">
        Pick a clinic in the sidebar to message its patients.
      </p>
    );
  }

  return (
    <div className="grid gap-4">
      {!isConfigured && (
        <p
          role="alert"
          className="rounded border border-amber-600/40 bg-amber-600/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-400"
        >
          WhatsApp is not connected yet. Set WHATSAPP_BSP_API_KEY in the
          environment before sending.
        </p>
      )}

      {error && (
        <p
          role="alert"
          className="rounded border border-red-600/40 bg-red-600/10 px-3 py-2 text-sm text-red-700 dark:text-red-400"
        >
          {error}
        </p>
      )}

      {outcome && <SendOutcome outcome={outcome} />}

      <div className="max-w-md">
        <label htmlFor="composer-template" className="mb-1 block text-sm font-medium">
          Template
        </label>
        <select
          id="composer-template"
          value={templateId}
          onChange={(event) => {
            setTemplateId(event.target.value);
            setOutcome(null);
          }}
          className={INPUT_CLASS}
        >
          {templates.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name}
            </option>
          ))}
        </select>
      </div>

      <div className="max-w-md">
        <label htmlFor="composer-search" className="mb-1 block text-sm font-medium">
          Add patients
        </label>
        <input
          id="composer-search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search by name, mobile number or Patient ID"
          aria-describedby="composer-search-help"
          className={INPUT_CLASS}
        />
        <p id="composer-search-help" className="mt-1 text-xs text-black/60 dark:text-white/60">
          {isSearching
            ? "Searching…"
            : `Patients at ${clinicName ?? "this clinic"}. Up to ${MAX_RECIPIENTS} per send.`}
        </p>

        {search.trim().length >= 2 && matches.length > 0 && (
          <ul className="mt-2 grid gap-1 rounded border border-black/15 p-1 dark:border-white/20">
            {matches.map((patient) => (
              <li key={patient.id}>
                <button
                  type="button"
                  onClick={() => addRecipient(patient)}
                  className="flex min-h-11 w-full items-center justify-between gap-3 rounded px-3 text-left text-sm hover:bg-black/5 dark:hover:bg-white/10"
                >
                  <span>
                    <span className="font-medium">{patient.name}</span>{" "}
                    <span className="text-black/55 dark:text-white/55">
                      {patient.patientCode}
                    </span>
                  </span>
                  <span className="tabular-nums text-black/55 dark:text-white/55">
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
          <p className="mb-1 text-sm font-medium">
            Sending to {recipients.length}{" "}
            {recipients.length === 1 ? "patient" : "patients"}
          </p>
          <ul className="flex flex-wrap gap-2">
            {recipients.map((patient) => (
              <li
                key={patient.id}
                className="flex items-center gap-2 rounded border border-black/15 py-1 pl-3 pr-1 dark:border-white/20"
              >
                <span className="text-sm">
                  {patient.name}{" "}
                  <span className="text-black/55 dark:text-white/55">
                    {patient.patientCode}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => removeRecipient(patient.id)}
                  aria-label={`Remove ${patient.name}`}
                  className="min-h-9 rounded px-2 text-sm text-black/60 hover:bg-black/5 dark:text-white/60 dark:hover:bg-white/10"
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
          <p className="mb-1 text-sm font-medium">Preview</p>
          <div className="rounded border border-black/15 p-3 dark:border-white/20">
            {template.mediaType && (
              <p className="mb-2 text-xs text-black/55 dark:text-white/55">
                With {template.mediaType} attachment
              </p>
            )}
            <p className="whitespace-pre-wrap text-sm">{preview}</p>
            {template.footer && (
              <p className="mt-2 text-xs text-black/55 dark:text-white/55">
                {template.footer}
              </p>
            )}
          </div>
          <p className="mt-1 text-xs text-black/60 dark:text-white/60">
            Doctor, department, visit date and amount are filled from each
            patient&apos;s most recent visit when the message is sent.
          </p>
        </div>
      )}

      <div>
        <button
          type="button"
          onClick={handleSend}
          disabled={!template || recipients.length === 0 || isSending || !isConfigured}
          className="min-h-11 rounded bg-foreground px-5 text-base font-medium text-background disabled:opacity-60"
        >
          {isSending
            ? `Sending to ${recipients.length}…`
            : recipients.length === 0
              ? "Send WhatsApp"
              : `Send WhatsApp to ${recipients.length}`}
        </button>
      </div>
    </div>
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
      className={`rounded border px-3 py-2 text-sm ${
        failures.length === 0
          ? "border-green-700/40 bg-green-700/10 text-green-800 dark:text-green-400"
          : "border-amber-600/40 bg-amber-600/10 text-amber-800 dark:text-amber-400"
      }`}
    >
      <p className="font-medium">
        {outcome.sent} sent
        {outcome.failed > 0 && `, ${outcome.failed} failed`} — {outcome.templateName}
      </p>
      {failures.length > 0 && (
        <ul className="mt-1 grid gap-0.5">
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
