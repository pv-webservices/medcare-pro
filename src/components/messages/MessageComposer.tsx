"use client";

import {
  ArrowLeft,
  Building2,
  CheckCheck,
  CheckCircle2,
  ChevronDown,
  Info,
  Mic,
  MoreVertical,
  Paperclip,
  Send,
  Smile,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { PatientMatch } from "@/lib/registrations";
import { renderTemplate } from "@/lib/whatsappTemplateText";
import type { TemplateRecord } from "@/lib/whatsappTemplates";
import type { RecipientResult, SendMessageResult } from "@/lib/whatsappMessages";
import Button from "@/components/ui/Button";
import { todayDateOnly } from "@/lib/dates";

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

  const [todayStr] = useState(() => todayDateOnly());
  const [yesterdayStr] = useState(() =>
    todayDateOnly(new Date(Date.now() - 86_400_000)),
  );

  const template = templates.find((entry) => entry.id === templateId) ?? null;

  useEffect(() => {
    const term = search.trim();

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
      router.refresh();
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setIsSending(false);
    }
  }

  const previewFor = recipients[0];
  const preview = template
    ? renderTemplate(template.body, {
        patientName: previewFor?.name ?? "John Doe",
        patientCode: previewFor?.patientCode ?? "PT-2026-0001",
        clinicName: clinicName ?? "Sharma Clinic",
        doctorName: "Dr. Smith",
        department: "General",
        visitDate: "15 Aug 2026",
        visitTime: "10:30 AM",
        amount: "₹ 500.00",
      })
    : "";

  if (!clinicId) {
    return (
      <div className="rounded-3xl border border-line bg-canvas px-6 py-10 text-center shadow-card">
        <p className="text-body font-medium text-muted">
          Pick a clinic in the sidebar to message its patients.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {!isConfigured && (
        <p
          role="alert"
          className="rounded-2xl border border-warn-line bg-warn-bg px-4 py-3 text-body text-warn-ink"
        >
          WhatsApp is not connected yet. Set WHATSAPP_BSP_API_KEY in the
          environment before sending.
        </p>
      )}

      {error && (
        <p
          role="alert"
          className="rounded-2xl border border-alert-line bg-alert-bg px-4 py-3 text-body text-alert-ink"
        >
          {error}
        </p>
      )}

      {outcome && <SendOutcome outcome={outcome} />}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 items-start">
        {/* Left Column: Send a message */}
        <section className="rounded-3xl border border-line bg-canvas p-6 sm:p-7 shadow-card space-y-5">
          <h2 className="text-lg font-bold tracking-tight text-ink">
            Send a message
          </h2>

          {/* Template select */}
          <div className="space-y-1.5">
            <label htmlFor="composer-template" className="block text-label font-semibold text-ink">
              Template
            </label>
            <div className="relative">
              <select
                id="composer-template"
                name="templateId"
                value={templateId}
                onChange={(event) => {
                  setTemplateId(event.target.value);
                  setOutcome(null);
                }}
                className="w-full appearance-none rounded-xl border border-line bg-canvas px-3.5 py-2.5 text-body text-ink shadow-sm outline-none transition-colors focus:border-accent"
              >
                {templates.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name}
                  </option>
                ))}
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-3.5 flex items-center text-muted">
                <ChevronDown className="h-4 w-4" aria-hidden="true" />
              </div>
            </div>
          </div>

          {/* Filter by visit date */}
          <div className="space-y-2">
            <label className="block text-label font-semibold text-ink">
              Filter by visit date
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => { setStartDateFilter(""); setEndDateFilter(""); }}
                className={`rounded-xl px-3.5 py-1.5 text-label font-medium transition-all ${
                  startDateFilter === "" && endDateFilter === ""
                    ? "bg-accent text-accent-ink font-semibold shadow-sm"
                    : "border border-line bg-canvas text-muted hover:bg-canvas-deep hover:text-ink"
                }`}
              >
                Any
              </button>
              <button
                type="button"
                onClick={() => { setStartDateFilter(todayStr); setEndDateFilter(todayStr); }}
                className={`rounded-xl px-3.5 py-1.5 text-label font-medium transition-all ${
                  startDateFilter === todayStr && endDateFilter === todayStr
                    ? "bg-accent text-accent-ink font-semibold shadow-sm"
                    : "border border-line bg-canvas text-muted hover:bg-canvas-deep hover:text-ink"
                }`}
              >
                Today
              </button>
              <button
                type="button"
                onClick={() => { setStartDateFilter(yesterdayStr); setEndDateFilter(yesterdayStr); }}
                className={`rounded-xl px-3.5 py-1.5 text-label font-medium transition-all ${
                  startDateFilter === yesterdayStr && endDateFilter === yesterdayStr
                    ? "bg-accent text-accent-ink font-semibold shadow-sm"
                    : "border border-line bg-canvas text-muted hover:bg-canvas-deep hover:text-ink"
                }`}
              >
                Yesterday
              </button>
              <div className="flex items-center gap-1.5">
                <input
                  type="date"
                  value={startDateFilter}
                  onChange={(e) => setStartDateFilter(e.target.value)}
                  className="h-9 rounded-xl border border-line bg-canvas px-2.5 text-label text-ink shadow-sm"
                />
                <span className="text-muted text-label">to</span>
                <input
                  type="date"
                  value={endDateFilter}
                  onChange={(e) => setEndDateFilter(e.target.value)}
                  className="h-9 rounded-xl border border-line bg-canvas px-2.5 text-label text-ink shadow-sm"
                />
              </div>
            </div>
          </div>

          {/* Add patients */}
          <div className="space-y-2">
            <label htmlFor="composer-search" className="block text-label font-semibold text-ink">
              Add patients
            </label>
            <div className="relative">
              <input
                id="composer-search"
                type="text"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search by name, mobile number or Patient ID"
                className="w-full rounded-xl border border-line bg-canvas px-3.5 py-2.5 text-body text-ink placeholder:text-muted/60 shadow-sm outline-none transition-colors focus:border-accent"
              />
            </div>
            <p className="text-micro text-muted">
              {isSearching
                ? "Searching…"
                : `Patients at ${clinicName ?? "this clinic"}. Up to ${MAX_RECIPIENTS} per send.`}
            </p>

            {/* Matches list */}
            {(search.trim().length >= 2 || startDateFilter !== "" || endDateFilter !== "") && matches.length > 0 && (
              <div className="mt-2 rounded-2xl border border-line bg-canvas p-2 shadow-card">
                <div className="flex justify-between items-center px-2 py-1 mb-1">
                  <span className="text-micro font-medium text-muted">{matches.length} patients found</span>
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
                    className="text-micro font-semibold text-accent hover:underline"
                  >
                    Select All
                  </button>
                </div>
                <ul className="max-h-60 overflow-y-auto divide-y divide-line/40">
                  {matches.map((patient) => (
                    <li key={patient.id}>
                      <button
                        type="button"
                        onClick={() => addRecipient(patient)}
                        className="flex min-h-11 w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-body hover:bg-canvas-deep transition-colors"
                      >
                        <div>
                          <span className="font-medium text-ink">{patient.name}</span>
                          <span className="ml-2 text-label text-muted">{patient.patientCode}</span>
                        </div>
                        <span className="tnum text-label text-muted">{patient.mobileNumber}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Selected recipients chips */}
            {recipients.length > 0 && (
              <div className="flex flex-wrap gap-2 pt-2">
                {recipients.map((patient) => (
                  <span
                    key={patient.id}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-canvas px-3 py-1 text-label font-medium text-ink shadow-sm"
                  >
                    <span>{patient.name}</span>
                    <span className="text-muted">·</span>
                    <span className="text-muted">{patient.patientCode}</span>
                    <button
                      type="button"
                      onClick={() => removeRecipient(patient.id)}
                      aria-label={`Remove ${patient.name}`}
                      className="ml-1 -mr-1 flex h-5 w-5 items-center justify-center rounded-md text-muted hover:bg-canvas-deep hover:text-ink transition-colors"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Primary CTA */}
          <div className="pt-2">
            <Button
              type="button"
              onClick={handleSend}
              disabled={!template || recipients.length === 0 || isSending || !isConfigured}
              variant="primary"
              isBusy={isSending}
              busyLabel={`Sending to ${recipients.length}…`}
              className="rounded-xl px-5 py-2.5 font-semibold text-body shadow-cta"
            >
              <Send className="h-4 w-4 mr-2" />
              Send WhatsApp
            </Button>
          </div>
        </section>

        {/* Right Column: WhatsApp Preview */}
        <section className="rounded-3xl border border-line bg-canvas p-6 sm:p-7 shadow-card flex flex-col justify-between">
          <h2 className="text-lg font-bold tracking-tight text-ink mb-4">
            Preview
          </h2>

          <div className="rounded-2xl border border-line overflow-hidden bg-[#EFEAE2] flex flex-col shadow-sm">
            {/* Header */}
            <div className="bg-[#F0F2F5] px-4 py-3 border-b border-line flex items-center justify-between">
              <div className="flex items-center gap-3">
                <ArrowLeft className="h-4 w-4 text-[#54656F]" aria-hidden="true" />
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#6366F1] text-white shadow-sm">
                  <Building2 className="h-5 w-5" />
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="font-semibold text-[#111B21] text-body">
                    {clinicName ?? "Sharma Clinic"}
                  </span>
                  <CheckCircle2 className="h-4 w-4 fill-[#25D366] text-white" aria-hidden="true" />
                </div>
              </div>
              <MoreVertical className="h-4 w-4 text-[#54656F]" aria-hidden="true" />
            </div>

            {/* Conversation Body */}
            <div className="p-4 sm:p-5 flex-1 flex flex-col justify-between min-h-[340px] bg-[#EFEAE2]">
              <div>
                <div className="my-2 flex justify-center">
                  <span className="rounded-lg bg-white/90 px-3 py-1 text-micro font-medium text-[#54656F] shadow-sm">
                    Today
                  </span>
                </div>

                {/* Message Bubble */}
                <div className="mt-3 max-w-[88%] rounded-2xl rounded-tl-xs bg-white p-4 text-body text-[#111B21] shadow-sm">
                  {template?.mediaType && (
                    <div className="mb-2 rounded-lg bg-canvas-deep px-2.5 py-1 text-meta font-medium text-muted">
                      📎 [{template.mediaType.toUpperCase()} attachment]
                    </div>
                  )}
                  <p className="whitespace-pre-wrap leading-relaxed text-body text-[#111B21]">
                    {preview || "No template selected."}
                  </p>
                  {template?.footer && (
                    <p className="mt-2 text-meta text-[#667781] italic">
                      {template.footer}
                    </p>
                  )}
                  <div className="mt-2 flex items-center justify-end gap-1 text-micro text-[#667781]">
                    <span className="tnum">11:30 AM</span>
                    <CheckCheck className="h-3.5 w-3.5 text-[#53BDEB]" aria-hidden="true" />
                  </div>
                </div>
              </div>

              <div className="mt-4 text-center">
                <span className="inline-block rounded-full bg-black/5 px-3 py-1 text-micro text-[#54656F]">
                  Visual preview only · Free-text messages not supported
                </span>
              </div>
            </div>

            {/* Mock Composer */}
            <div className="bg-[#F0F2F5] px-3 py-2 border-t border-line flex items-center gap-2">
              <Smile className="h-5 w-5 text-[#54656F]" aria-hidden="true" />
              <div className="flex-1 rounded-xl bg-white px-3 py-2 text-label text-[#8696A0] border border-line select-none">
                Type a message
              </div>
              <Paperclip className="h-5 w-5 text-[#54656F]" aria-hidden="true" />
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#25D366] text-white shadow-sm">
                <Mic className="h-4 w-4" aria-hidden="true" />
              </div>
            </div>
          </div>
        </section>
      </div>

      {/* Inset Information Note */}
      <div className="flex items-center gap-2 text-label text-muted pt-1">
        <Info className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
        <span>
          Doctor, department, visit date and amount are filled from each patient&apos;s most recent visit when the message is sent.
        </span>
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
      className={`rounded-xl border px-4 py-3 text-body font-medium ${
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
        <ul className="mt-2 grid gap-1 text-meta">
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
