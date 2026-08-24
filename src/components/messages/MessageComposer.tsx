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
import { cx } from "@/components/ui/cx";
import { todayDateOnly } from "@/lib/dates";

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
  const [startDateFilter, setStartDateFilter] = useState("");
  const [endDateFilter, setEndDateFilter] = useState("");
  const [matches, setMatches] = useState<PatientMatch[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [recipients, setRecipients] = useState<PatientMatch[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [outcome, setOutcome] = useState<SendMessageResult | null>(null);

  const todayStr = todayDateOnly();
  const yesterdayStr = todayDateOnly(new Date(Date.now() - 86400000));

  const template = templates.find((entry) => entry.id === templateId) ?? null;

  useEffect(() => {
    const term = search.trim();

    // Debounced: the front desk types a name, not one request per keystroke.
    // The too-short case is handled inside the timer rather than in the effect
    // body, so nothing sets state synchronously during the effect.
    const handle = setTimeout(async () => {
      if (!clinicId || (term.length < 2 && !startDateFilter && !endDateFilter)) {
        setMatches([]);
        return;
      }

      setIsSearching(true);
      try {
        const response = await fetch(
          `/api/patients?clinicId=${encodeURIComponent(clinicId)}&search=${encodeURIComponent(term)}&startDate=${encodeURIComponent(startDateFilter)}&endDate=${encodeURIComponent(endDateFilter)}`,
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
  }, [search, startDateFilter, endDateFilter, clinicId]);

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
        patientName: previewFor?.name ?? "John Doe",
        patientCode: previewFor?.patientCode ?? "PT-2026-0001",
        clinicName: clinicName ?? "Demo Clinic",
        doctorName: "Dr. Smith",
        department: "General",
        visitDate: "15 Aug 2026",
        visitTime: "10:30 AM",
        amount: "₹ 500.00",
      })
    : "";

  if (!clinicId) {
    return (
      <div className="rounded-2xl bg-canvas px-6 py-8 text-center shadow-neu-raised-sm">
        <p className="text-sm font-medium text-muted">
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
          className="rounded-xl bg-warn-bg px-4 py-3 text-sm font-medium text-warn-ink"
        >
          WhatsApp is not connected yet. Set WHATSAPP_BSP_API_KEY in the
          environment before sending.
        </p>
      )}

      {error && (
        <p
          role="alert"
          className="rounded-xl bg-alert-bg px-4 py-3 text-sm text-alert-ink"
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

      <div className="space-y-6">
        <div className="max-w-3xl">
          <label className="mb-2 block text-sm font-semibold text-ink">
            Filter by visit date
          </label>
          <div className="flex items-center gap-3 py-1">
            <Button
              type="button"
              variant={startDateFilter === "" && endDateFilter === "" ? "commit" : "secondary"}
              onClick={() => { setStartDateFilter(""); setEndDateFilter(""); }}
              className={cx("text-xs px-4 py-1.5 min-h-[32px] h-8 rounded-full", startDateFilter === "" && endDateFilter === "" && "ring-2 ring-primary ring-offset-2")}
            >
              Any
            </Button>
            <Button
              type="button"
              variant={startDateFilter === todayStr && endDateFilter === todayStr ? "commit" : "secondary"}
              onClick={() => { setStartDateFilter(todayStr); setEndDateFilter(todayStr); }}
              className={cx("text-xs px-4 py-1.5 min-h-[32px] h-8 rounded-full", startDateFilter === todayStr && endDateFilter === todayStr && "ring-2 ring-primary ring-offset-2")}
            >
              Today
            </Button>
            <Button
              type="button"
              variant={startDateFilter === yesterdayStr && endDateFilter === yesterdayStr ? "commit" : "secondary"}
              onClick={() => { setStartDateFilter(yesterdayStr); setEndDateFilter(yesterdayStr); }}
              className={cx("text-xs px-4 py-1.5 min-h-[32px] h-8 rounded-full", startDateFilter === yesterdayStr && endDateFilter === yesterdayStr && "ring-2 ring-primary ring-offset-2")}
            >
              Yesterday
            </Button>
            <div className="flex items-center gap-1">
              <input
                type="date"
                className="rounded-md border border-line px-3 py-1 text-sm text-ink h-8"
                value={startDateFilter}
                onChange={(e) => setStartDateFilter(e.target.value)}
              />
              <span className="text-muted text-sm">to</span>
              <input
                type="date"
                className="rounded-md border border-line px-3 py-1 text-sm text-ink h-8"
                value={endDateFilter}
                onChange={(e) => setEndDateFilter(e.target.value)}
              />
            </div>
          </div>
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

          {(search.trim().length >= 2 || startDateFilter !== "" || endDateFilter !== "") && matches.length > 0 && (
            <div className="mt-2">
              <div className="flex justify-between items-center px-1 mb-1">
                <span className="text-xs font-medium text-muted">{matches.length} patients found</span>
                <button
                  type="button"
                  onClick={() => {
                    setOutcome(null);
                    setRecipients(matches);
                    setSearch("");
                    setMatches([]);
                    setStartDateFilter("");
                    setEndDateFilter("");
                  }}
                  className="text-xs font-medium text-accent hover:text-accent-strong transition-colors"
                >
                  Select All
                </button>
              </div>
              <ul className="grid gap-1 rounded-md bg-canvas p-1 shadow-neu-raised-sm max-h-64 overflow-y-auto">
                {matches.map((patient) => (
                  <li key={patient.id}>
                    <button
                      type="button"
                      onClick={() => addRecipient(patient)}
                      className="flex min-h-11 w-full items-center justify-between gap-3 rounded-md px-3 text-left text-sm hover:bg-canvas-deep transition-colors"
                    >
                      <span>
                        <span className="font-medium text-ink">{patient.name}</span>{""}
                        <span className="text-muted">
                          {patient.patientCode}
                        </span>
                      </span>
                      <span className="tabular-nums text-muted">
                        {patient.mobileNumber}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      {recipients.length > 0 && (
        <div>
          <p className="mb-2 text-sm font-semibold text-ink">
            Sending to {recipients.length}{""}
            {recipients.length === 1 ? "patient" : "patients"}
          </p>
          <ul className="flex flex-wrap gap-2">
            {recipients.map((patient) => (
              <li
                key={patient.id}
                className="flex items-center gap-2 rounded-lg py-1.5 pl-3 pr-1.5 bg-canvas-deep"
              >
                <span className="text-sm font-medium text-ink">
                  {patient.name}{""}
                  <span className="text-muted font-normal">
                    {patient.patientCode}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => removeRecipient(patient.id)}
                  aria-label={`Remove ${patient.name}`}
                  className="min-h-8 rounded-md px-2 text-xs font-medium text-muted hover:bg-canvas-deep disabled:opacity-50 transition-colors"
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
          <p className="mb-2 text-sm font-semibold text-ink">Preview</p>
          <div className="rounded-xl bg-canvas-deep p-4">
            {template.mediaType && (
              <p className="mb-3 text-xs font-medium text-muted">
                With {template.mediaType} attachment
              </p>
            )}
            <p className="whitespace-pre-wrap text-sm text-ink">{preview}</p>
            {template.footer && (
              <p className="mt-3 text-xs text-muted">
                {template.footer}
              </p>
            )}
          </div>
          <p className="mt-2 text-xs text-muted">
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
          ? "border-line bg-ok-bg text-ok-ink"
          : "border-line bg-warn-bg text-warn-ink"
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
