"use client";

import {
  ArrowLeft,
  Building2,
  CheckCheck,
  CheckCircle2,
  Info,
  Mic,
  MoreVertical,
  Paperclip,
  Send,
  Smile,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { PatientMatch } from "@/lib/registrations";
import { renderTemplate } from "@/lib/whatsappTemplateText";
import type { TemplateRecord } from "@/lib/whatsappTemplates";
import type {
  RecipientResult,
  SendMessageResult,
  SentToday,
} from "@/lib/whatsappMessages";
import { toWhatsappDigits } from "@/lib/whatsappNumber";
import Button from "@/components/ui/Button";
import DatePicker from "@/components/ui/DatePicker";
import Select from "@/components/ui/Select";
import { todayDateOnly } from "@/lib/dates";
import WhatsAppMediaPreview from "@/components/messages/WhatsAppMediaPreview";
import PatientMatchList from "@/components/messages/PatientMatchList";

interface MessageComposerProps {
  templates: readonly TemplateRecord[];
  clinicId: string | null;
  clinicName: string | null;
  isConfigured: boolean;
}

const SEARCH_DEBOUNCE_MS = 300;
/** Mirrors MAX_RECIPIENTS in @/lib/whatsappMessages, which enforces it. */
const MAX_RECIPIENTS = 50;
/**
 * Patients per request. A whole batch in one request can run for minutes —
 * a number check and a send per patient — and outlive the hosting proxy's
 * timeout: the browser then reports a failure while the server carries on
 * sending, and pressing Send again overlapped the two. Small requests finish
 * well inside that limit and let the button show real progress.
 */
const SEND_CHUNK_SIZE = 5;

const EMPTY_SENT_TODAY: SentToday = { patientIds: [], mobileNumbers: [] };

function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

type PostSendResult =
  | { ok: true; data: SendMessageResult }
  | { ok: false; error: string };

/** One request to the send route, for one chunk of the selection. */
async function postSend(
  templateId: string,
  patients: readonly PatientMatch[],
): Promise<PostSendResult> {
  try {
    const response = await fetch("/api/whatsapp/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ templateId, patientIds: patients.map((entry) => entry.id) }),
    });
    const payload: { success?: boolean; error?: string; data?: SendMessageResult } =
      await response.json().catch(() => ({}));

    if (!response.ok || !payload.success || !payload.data) {
      return { ok: false, error: payload.error ?? "Could not send. Try again." };
    }
    return { ok: true, data: payload.data };
  } catch {
    return {
      ok: false,
      error: "Could not reach the server. Check your connection and try again.",
    };
  }
}

/** Folds each request's result into one outcome for the whole send. */
function mergeOutcomes(
  total: SendMessageResult | null,
  next: SendMessageResult,
): SendMessageResult {
  if (!total) return next;
  return {
    templateName: next.templateName,
    sent: total.sent + next.sent,
    failed: total.failed + next.failed,
    skipped: total.skipped + next.skipped,
    results: [...total.results, ...next.results],
  };
}

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
  const [notice, setNotice] = useState<string | null>(null);
  const [sentToday, setSentToday] = useState<SentToday>(EMPTY_SENT_TODAY);
  const [sentTodayVersion, setSentTodayVersion] = useState(0);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  // State updates land a render late, so a fast double-click could start two
  // sends before `isSending` disabled the button. The ref flips immediately.
  const isSendingRef = useRef(false);

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

  // Advisory markers only — the send route skips these patients itself.
  useEffect(() => {
    // Nothing to mark: the composer renders no picker without both.
    if (!clinicId || !templateId) return;

    let isCurrent = true;
    (async () => {
      try {
        const response = await fetch(
          `/api/whatsapp/sent-today?clinicId=${encodeURIComponent(clinicId)}&templateId=${encodeURIComponent(templateId)}`,
        );
        const payload: { success?: boolean; data?: SentToday } =
          await response.json().catch(() => ({}));
        if (isCurrent) {
          setSentToday(payload.success && payload.data ? payload.data : EMPTY_SENT_TODAY);
        }
      } catch {
        if (isCurrent) setSentToday(EMPTY_SENT_TODAY);
      }
    })();

    return () => {
      isCurrent = false;
    };
  }, [clinicId, templateId, sentTodayVersion]);

  const sentTodayPatientIds = new Set(sentToday.patientIds);
  const sentTodayNumbers = new Set(sentToday.mobileNumbers);
  // A record counts as reached when it, or any record sharing its phone, got
  // the template today — the phone is what receives the message.
  const isSentToday = (patient: PatientMatch) =>
    sentTodayPatientIds.has(patient.id) ||
    sentTodayNumbers.has(toWhatsappDigits(patient.mobileNumber));
  const sentTodayIds = new Set(
    [...matches, ...recipients].filter(isSentToday).map((patient) => patient.id),
  );

  const selectedIds = new Set(recipients.map((entry) => entry.id));
  const selectedByNumber = new Map(
    recipients.map((entry) => [toWhatsappDigits(entry.mobileNumber), entry]),
  );
  const selectedSentToday = recipients.filter(isSentToday);

  function alreadySentMessage(patient: PatientMatch): string {
    const templateName = template?.name ?? "this template";
    return sentTodayPatientIds.has(patient.id)
      ? `${patient.name} (${patient.patientCode}) has already been sent "${templateName}" today. The same template can be sent to a patient once a day.`
      : `${patient.mobileNumber} has already been sent "${templateName}" today through another patient record with the same number, so ${patient.name} (${patient.patientCode}) would receive it twice.`;
  }

  function toggleRecipient(patient: PatientMatch) {
    setOutcome(null);

    if (selectedIds.has(patient.id)) {
      setNotice(null);
      setRecipients((current) => current.filter((entry) => entry.id !== patient.id));
      return;
    }
    if (isSentToday(patient)) {
      setNotice(alreadySentMessage(patient));
      return;
    }
    const sameNumber = selectedByNumber.get(toWhatsappDigits(patient.mobileNumber));
    if (sameNumber) {
      setNotice(
        `${patient.name} (${patient.patientCode}) has the same mobile number as ${sameNumber.name} (${sameNumber.patientCode}), who is already selected. One message per number, so that phone does not receive it twice.`,
      );
      return;
    }
    if (recipients.length >= MAX_RECIPIENTS) {
      setNotice(
        `You can send to at most ${MAX_RECIPIENTS} patients at a time. Remove someone to add ${patient.name}, or send this batch first.`,
      );
      return;
    }

    setNotice(null);
    setRecipients((current) => [...current, patient]);
  }

  function selectAvailable() {
    setOutcome(null);
    const room = MAX_RECIPIENTS - recipients.length;
    const numbers = new Set(selectedByNumber.keys());
    const added: PatientMatch[] = [];
    let leftOver = 0;
    let skippedSent = 0;
    let skippedSameNumber = 0;

    for (const patient of matches) {
      if (selectedIds.has(patient.id)) continue;
      if (isSentToday(patient)) {
        skippedSent += 1;
        continue;
      }
      const number = toWhatsappDigits(patient.mobileNumber);
      if (numbers.has(number)) {
        skippedSameNumber += 1;
        continue;
      }
      if (added.length >= room) {
        leftOver += 1;
        continue;
      }
      numbers.add(number);
      added.push(patient);
    }

    const parts: string[] = [];
    if (leftOver > 0) {
      parts.push(
        `Selected ${added.length} — a send is limited to ${MAX_RECIPIENTS} patients. Send this batch, then select the rest.`,
      );
    }
    if (skippedSent > 0) {
      parts.push(
        `${skippedSent} ${skippedSent === 1 ? "patient was" : "patients were"} left out because they already received this template today.`,
      );
    }
    if (skippedSameNumber > 0) {
      parts.push(
        `${skippedSameNumber} ${skippedSameNumber === 1 ? "record was" : "records were"} left out because the mobile number is shared with a patient already selected.`,
      );
    }
    setNotice(parts.length > 0 ? parts.join(" ") : null);
    setRecipients((current) => [...current, ...added]);
  }

  function clearRecipients() {
    setOutcome(null);
    setNotice(null);
    setRecipients([]);
  }

  function removeRecipient(patientId: string) {
    setOutcome(null);
    setNotice(null);
    setRecipients((current) => current.filter((entry) => entry.id !== patientId));
  }

  function removeSentToday() {
    setNotice(null);
    setRecipients((current) => current.filter((entry) => !sentTodayIds.has(entry.id)));
  }

  async function handleSend() {
    if (!template || recipients.length === 0 || isSendingRef.current) return;
    isSendingRef.current = true;

    const batch = recipients;
    let total: SendMessageResult | null = null;
    let done = 0;

    setError(null);
    setOutcome(null);
    setNotice(null);
    setIsSending(true);
    setProgress({ done: 0, total: batch.length });
    try {
      for (const group of chunk(batch, SEND_CHUNK_SIZE)) {
        const result = await postSend(template.id, group);

        if (!result.ok) {
          setError(
            done === 0
              ? result.error
              : `Sending stopped after ${done} of ${batch.length} patients: ${result.error} The rest are still selected — press Send to continue. Anyone who already received it is skipped automatically.`,
          );
          break;
        }

        total = mergeOutcomes(total, result.data);
        done += group.length;
        const finished = new Set(group.map((entry) => entry.id));
        setRecipients((current) => current.filter((entry) => !finished.has(entry.id)));
        setProgress({ done, total: batch.length });
        setOutcome(total);
      }
    } finally {
      isSendingRef.current = false;
      setIsSending(false);
      setProgress(null);
      setSentTodayVersion((version) => version + 1);
      router.refresh();
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
          WhatsApp is not connected yet. Ask an administrator to configure a
          provider account and sending device in Settings.
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
          <Select
            id="composer-template"
            name="templateId"
            label="Template"
            value={templateId}
            onChange={(event) => {
              setTemplateId(event.target.value);
              setOutcome(null);
              setNotice(null);
            }}
          >
            {templates.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}
              </option>
            ))}
          </Select>

          {/* Filter by visit date */}
          <div className="space-y-3">
            <div>
              <label className="block text-label font-semibold text-ink mb-2">
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
              </div>
            </div>

            {/* Standard From / To DatePicker controls matching Registrations reference */}
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <DatePicker
                  id="composer-filter-from"
                  label="From"
                  value={startDateFilter}
                  maxDate={endDateFilter || undefined}
                  onChange={(newDate) => {
                    setStartDateFilter(newDate);
                    if (endDateFilter && newDate && newDate > endDateFilter) {
                      setEndDateFilter(newDate);
                    }
                  }}
                  placeholder="Select date"
                />
              </div>
              <div>
                <DatePicker
                  id="composer-filter-to"
                  label="To"
                  value={endDateFilter}
                  minDate={startDateFilter || undefined}
                  onChange={(newDate) => {
                    setEndDateFilter(newDate);
                    if (startDateFilter && newDate && newDate < startDateFilter) {
                      setStartDateFilter(newDate);
                    }
                  }}
                  placeholder="Select date"
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
              {isSearching ? (
                "Searching…"
              ) : (
                <>
                  Patients at {clinicName ?? "this clinic"}. Tick any patients —{" "}
                  <span className="tnum font-semibold text-ink">{recipients.length}</span> of{" "}
                  <span className="tnum">{MAX_RECIPIENTS}</span> selected.
                </>
              )}
            </p>

            {notice && (
              <p
                role="alert"
                className="rounded-2xl border border-warn-line bg-warn-bg px-4 py-3 text-label text-warn-ink"
              >
                {notice}
              </p>
            )}

            {/* Matches list */}
            {(search.trim().length >= 2 || startDateFilter !== "" || endDateFilter !== "") && matches.length > 0 && (
              <PatientMatchList
                matches={matches}
                selectedIds={selectedIds}
                sentTodayIds={sentTodayIds}
                maxRecipients={MAX_RECIPIENTS}
                onToggle={toggleRecipient}
                onSelectAvailable={selectAvailable}
                onClearSelection={clearRecipients}
              />
            )}

            {selectedSentToday.length > 0 && (
              <div
                role="alert"
                className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-warn-line bg-warn-bg px-4 py-3 text-label text-warn-ink"
              >
                <span>
                  <span className="tnum">{selectedSentToday.length}</span> selected{" "}
                  {selectedSentToday.length === 1 ? "patient has" : "patients have"} already
                  been sent &ldquo;{template?.name}&rdquo; today and will be skipped.
                </span>
                <button
                  type="button"
                  onClick={removeSentToday}
                  className="font-semibold underline"
                >
                  Remove them
                </button>
              </div>
            )}

            {/* Selected recipients chips */}
            {recipients.length > 0 && (
              <div className="flex flex-wrap gap-2 pt-2">
                {recipients.map((patient) => (
                  <span
                    key={patient.id}
                    className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1 text-label font-medium shadow-sm ${
                      sentTodayIds.has(patient.id)
                        ? "border-warn-line bg-warn-bg text-warn-ink"
                        : "border-line bg-canvas text-ink"
                    }`}
                  >
                    <span>{patient.name}</span>
                    <span className="text-muted">·</span>
                    <span className="serial text-muted">{patient.patientCode}</span>
                    {sentTodayIds.has(patient.id) && (
                      <span className="text-meta">· sent today</span>
                    )}
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
              busyLabel={
                progress
                  ? `Sending… ${progress.done} of ${progress.total} done`
                  : "Sending…"
              }
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
                  <WhatsAppMediaPreview
                    clinicMediaAsset={template?.clinicMediaAsset}
                    legacyMediaType={template?.mediaType}
                    legacyMediaUrl={template?.mediaUrl}
                  />
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
                  Visual preview only · MedCarePro sends saved templates only in this workflow
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
  const problems = outcome.results.filter(
    (result: RecipientResult) => result.status !== "sent",
  );

  return (
    <div
      role="status"
      className={`rounded-xl border px-4 py-3 text-body font-medium ${
        problems.length === 0
          ? "border-line bg-ok-bg text-ok-ink"
          : "border-line bg-warn-bg text-warn-ink"
      }`}
    >
      <p>
        {outcome.sent} sent
        {outcome.failed > 0 && `, ${outcome.failed} failed`}
        {outcome.skipped > 0 && `, ${outcome.skipped} skipped (already sent today)`} —{" "}
        {outcome.templateName}
      </p>
      {problems.length > 0 && (
        <ul className="mt-2 grid gap-1 text-meta">
          {problems.map((result) => (
            <li key={result.patientId}>
              {result.patientName} ({result.patientCode}): {result.failureReason}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
