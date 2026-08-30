"use client";

import { Info, MessageSquare } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import Button from "@/components/ui/Button";
import Select from "@/components/ui/Select";
import { useToast } from "@/components/ui/Toast";
import { renderTemplate, type TemplateValues } from "@/lib/whatsappTemplateText";

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
    templates.length >= 1 ? templates[0].id : "",
  );
  const [isSending, setIsSending] = useState(false);

  const chosen = templates.find((template) => template.id === templateId) ?? null;

  if (refusal) {
    return (
      <p className="rounded-2xl border border-line bg-canvas-deep px-5 py-4 text-body text-muted">
        {refusal}
      </p>
    );
  }

  if (templates.length === 0) {
    return (
      <p className="rounded-2xl border border-line bg-canvas-deep px-5 py-4 text-body text-muted">
        No approved templates exist yet. An admin writes them on the{" "}
        <Link href="/messages" className="font-semibold text-accent underline">
          Messages
        </Link>{" "}
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
      {templates.length > 1 && (
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
      )}

      {chosen && (
        <div className="rounded-2xl border border-line/70 bg-canvas-deep/50 p-4">
          <p className="font-semibold text-ink text-label">
            {chosen.name}
          </p>
          <p className="mt-1.5 whitespace-pre-wrap text-body text-ink-soft">
            {renderTemplate(chosen.body, values)}
          </p>
          {chosen.footer && (
            <p className="mt-2 border-t border-line/60 pt-2 text-micro text-muted">
              {chosen.footer}
            </p>
          )}
        </div>
      )}

      <div className="space-y-2.5">
        <Button
          type="button"
          variant="primary"
          onClick={handleSend}
          disabled={!chosen}
          isBusy={isSending}
          busyLabel="Sending…"
          className="w-full rounded-xl py-2.5 font-semibold shadow-sm flex items-center justify-center gap-2 bg-[#25D366] hover:bg-[#20bd5a] text-white border-transparent"
        >
          <MessageSquare className="h-4 w-4" aria-hidden="true" />
          Send WhatsApp reminder
        </Button>

        <p className="flex items-center gap-1.5 text-label text-muted">
          <Info className="h-3.5 w-3.5 text-muted shrink-0" aria-hidden="true" />
          <span>This message uses an approved template.</span>
        </p>
      </div>
    </div>
  );
}
