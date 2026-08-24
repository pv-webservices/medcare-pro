"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Button from "@/components/ui/Button";
import { Select } from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";
import { renderTemplate, type TemplateValues } from "@/lib/whatsappTemplateText";

/**
 * Sending an approved reminder about this appointment — AP-8.
 *
 * NO FREE TEXT, and no way to add any. The desk picks one of the account's
 * approved templates and sees exactly what it will say; there is no editable
 * body here, because there is no endpoint that would accept one. That is the
 * WhatsApp compliance rule in CLAUDE.md, kept where it is easiest to break it.
 *
 * THE PREVIEW IS THE REAL SUBSTITUTION. `renderTemplate` is the same pure
 * function the server runs on the same values, imported from the same module —
 * so a preview that reads correctly is evidence the message will. A preview
 * rendered by a second, approximate implementation would be worse than none.
 *
 * The em dash in a preview is meaningful: it is a placeholder this appointment
 * has nothing for, most often a visit-group token in a template written for the
 * Messages screen. Better seen here than sent.
 */

export interface ReminderTemplateOption {
  id: string;
  name: string;
  body: string;
  footer: string | null;
}

interface SendReminderPanelProps {
  appointmentId: string;
  templates: readonly ReminderTemplateOption[];
  /** The values the server will substitute, so the preview cannot disagree. */
  values: TemplateValues;
  /** Non-null = this appointment cannot be reminded, and this is why. */
  refusal: string | null;
}

export default function SendReminderPanel({
  appointmentId,
  templates,
  values,
  refusal,
}: SendReminderPanelProps) {
  const router = useRouter();
  const showToast = useToast();

  const [templateId, setTemplateId] = useState(
    templates.length === 1 ? templates[0].id : "",
  );
  const [isSending, setIsSending] = useState(false);

  const chosen = templates.find((template) => template.id === templateId) ?? null;

  if (refusal) {
    return (
      <p className="rounded-xl bg-canvas-deep px-5 py-4 text-sm font-medium text-muted">
        {refusal}
      </p>
    );
  }

  if (templates.length === 0) {
    return (
      <p className="rounded-xl bg-canvas-deep px-5 py-4 text-sm font-medium text-muted">
        No approved templates exist yet. An admin writes them on the{""}
        <Link href="/messages" className="font-semibold text-primary underline">
          Messages
        </Link>{""}
        screen — only approved wording can be sent.
      </p>
    );
  }

  async function handleSend() {
    if (!chosen) return;

    setIsSending(true);
    try {
      const response = await fetch(`/api/appointments/${appointmentId}/remind`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId: chosen.id }),
      });

      const body: {
        success?: boolean;
        error?: string;
        data?: { status?: string; failureReason?: string | null };
      } = await response.json().catch(() => ({}));

      if (!response.ok || !body.success) {
        showToast({
          tone: "alert",
          title: "Reminder not sent.",
          detail: body.error ?? "Try again.",
        });
        return;
      }

      // The gateway can accept the request and still refuse the number, so a
      // 200 is not by itself good news — the row's own status decides.
      if (body.data?.status === "sent") {
        showToast({
          tone: "ok",
          title: "Reminder sent.",
          detail: "The gateway accepted it. Delivery is not confirmed.",
        });
      } else {
        showToast({
          tone: "alert",
          title: "The gateway refused this reminder.",
          detail: body.data?.failureReason ?? "No reason was given.",
        });
      }

      router.refresh();
    } catch {
      showToast({
        tone: "alert",
        title: "Could not reach the server.",
        detail: "Check your connection and try again.",
      });
    } finally {
      setIsSending(false);
    }
  }

  return (
    <div className="space-y-4">
      <Select
        id="reminder-template"
        name="templateId"
        label="Approved template"
        value={templateId}
        onChange={(event) => setTemplateId(event.target.value)}
        hint="Only wording an admin has approved can be sent."
      >
        <option value="">Choose a template…</option>
        {templates.map((template) => (
          <option key={template.id} value={template.id}>
            {template.name}
          </option>
        ))}
      </Select>

      {chosen && (
        <div className="rounded-2xl bg-canvas-deep px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">
            What will be sent
          </p>
          <p className="mt-2 whitespace-pre-wrap text-sm text-ink">
            {renderTemplate(chosen.body, values)}
          </p>
          {chosen.footer && (
            <p className="mt-2 border-t border-line pt-2 text-xs text-muted">
              {chosen.footer}
            </p>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="commit"
          onClick={handleSend}
          disabled={!chosen}
          isBusy={isSending}
          busyLabel="Sending…"
        >
          Send Reminder
        </Button>
        <p className="text-xs text-muted">
          Sending records the attempt against this patient, whether it succeeds
          or fails.
        </p>
      </div>
    </div>
  );
}
