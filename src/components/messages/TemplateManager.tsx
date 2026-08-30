"use client";

import { Pencil, Plus } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { MEDIA_TYPES } from "@/lib/whatsapp";
import {
  PLACEHOLDER_LABELS,
  TEMPLATE_PLACEHOLDERS,
  unknownPlaceholders,
} from "@/lib/whatsappTemplateText";
import type { TemplateRecord } from "@/lib/whatsappTemplates";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";

interface TemplateManagerProps {
  templates: readonly TemplateRecord[];
  canManage: boolean;
  clinicName?: string | null;
}

interface DraftState {
  id: string | null;
  name: string;
  body: string;
  footer: string;
  mediaType: string;
  mediaUrl: string;
}

const EMPTY_DRAFT: DraftState = {
  id: null,
  name: "",
  body: "",
  footer: "",
  mediaType: "",
  mediaUrl: "",
};

export default function TemplateManager({
  templates,
  canManage,
  clinicName,
}: TemplateManagerProps) {
  const router = useRouter();
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const badTokens = draft ? unknownPlaceholders(draft.body) : [];
  const mediaHalfSet = draft
    ? Boolean(draft.mediaType) !== Boolean(draft.mediaUrl)
    : false;
  const canSave =
    draft !== null &&
    draft.name.trim() !== "" &&
    draft.body.trim() !== "" &&
    badTokens.length === 0 &&
    !mediaHalfSet;

  async function send(method: "POST" | "PATCH" | "DELETE", body: object) {
    setError(null);
    try {
      const response = await fetch("/api/whatsapp/templates", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload: { success?: boolean; error?: string } = await response
        .json()
        .catch(() => ({}));

      if (!response.ok || !payload.success) {
        setError(payload.error ?? "Could not save that template. Try again.");
        return false;
      }

      router.refresh();
      return true;
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
      return false;
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || !canSave) return;

    setIsSaving(true);
    const payload = {
      name: draft.name,
      body: draft.body,
      footer: draft.footer,
      mediaType: draft.mediaType,
      mediaUrl: draft.mediaUrl,
    };

    const ok = draft.id
      ? await send("PATCH", { templateId: draft.id, ...payload })
      : await send("POST", payload);

    if (ok) {
      setDraft(null);
    }
    setIsSaving(false);
  }

  async function handleDelete(templateId: string) {
    setRemovingId(templateId);
    await send("DELETE", { templateId });
    setRemovingId(null);
  }

  function insertPlaceholder(token: string) {
    setDraft((current) =>
      current === null ? current : { ...current, body: `${current.body}{${token}}` },
    );
  }

  return (
    <section aria-labelledby="templates-heading" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 id="templates-heading" className="text-lg font-bold tracking-tight text-ink">
            Message templates
          </h2>
          <p className="mt-0.5 text-label text-muted">
            Only these can be sent. Nothing else goes out from this account.
          </p>
        </div>
        {canManage && draft === null && (
          <Button
            onClick={() => setDraft({ ...EMPTY_DRAFT })}
            variant="primary"
            className="rounded-xl px-4 py-2 font-semibold text-body shadow-cta flex items-center gap-1.5"
          >
            <Plus className="h-4 w-4" />
            Add template
          </Button>
        )}
      </div>

      {error && (
        <p
          role="alert"
          className="rounded-2xl border border-alert-line bg-alert-bg px-4 py-3 text-body text-alert-ink"
        >
          {error}
        </p>
      )}

      {draft && (
        <div className="rounded-3xl border border-line bg-canvas p-6 sm:p-7 shadow-card mb-6">
          <h3 className="text-base font-bold text-ink mb-4">
            {draft.id ? "Edit template" : "New template"}
          </h3>
          <form onSubmit={handleSubmit} className="grid gap-5">
            <div className="max-w-md">
              <Input
                id="template-name"
                name="name"
                label="Template name"
                value={draft.name}
                onChange={(event) =>
                  setDraft({ ...draft, name: event.target.value })
                }
                required
                maxLength={120}
                placeholder="e.g. Appointment reminder"
              />
            </div>

            <div>
              <label htmlFor="template-body" className="mb-1.5 block text-label font-semibold text-ink">
                Message
              </label>
              <textarea
                id="template-body"
                value={draft.body}
                onChange={(event) =>
                  setDraft({ ...draft, body: event.target.value })
                }
                required
                rows={5}
                maxLength={4000}
                aria-invalid={badTokens.length > 0}
                aria-describedby="template-body-help"
                className={`block w-full rounded-xl border bg-canvas px-3.5 py-2.5 text-body outline-none transition-colors ${
                  badTokens.length > 0 ? "border-alert-line focus:border-alert-line" : "border-line focus:border-accent"
                }`}
              />
              <p
                id="template-body-help"
                className={`mt-2 text-micro ${
                  badTokens.length > 0 ? "text-alert-ink" : "text-muted"
                }`}
              >
                {badTokens.length > 0
                  ? `Nothing can fill {${badTokens[0]}}. Use one of the placeholders below.`
                  : "Tap a placeholder to insert it. Each is filled per patient when the message is sent."}
              </p>

              <ul className="mt-3 flex flex-wrap gap-2">
                {TEMPLATE_PLACEHOLDERS.map((token) => (
                  <li key={token}>
                    <button
                      type="button"
                      onClick={() => insertPlaceholder(token)}
                      className="rounded-lg border border-line bg-canvas px-2.5 py-1 text-micro font-medium text-ink shadow-sm hover:bg-canvas-deep transition-colors"
                    >
                      {PLACEHOLDER_LABELS[token]}
                    </button>
                  </li>
                ))}
              </ul>
            </div>

            <div className="max-w-md">
              <Input
                id="template-footer"
                name="footer"
                label="Footer"
                hint="Optional."
                value={draft.footer}
                onChange={(event) =>
                  setDraft({ ...draft, footer: event.target.value })
                }
                maxLength={255}
                placeholder="e.g. Sent by Sharma Clinic"
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-[auto_1fr]">
              <div>
                <Select
                  id="template-media-type"
                  name="mediaType"
                  label="Attach"
                  value={draft.mediaType}
                  onChange={(event) =>
                    setDraft({ ...draft, mediaType: event.target.value })
                  }
                >
                  <option value="">Text only</option>
                  {MEDIA_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {type.charAt(0).toUpperCase() + type.slice(1)}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Input
                  id="template-media-url"
                  name="mediaUrl"
                  label="File link"
                  type="url"
                  value={draft.mediaUrl}
                  onChange={(event) =>
                    setDraft({ ...draft, mediaUrl: event.target.value })
                  }
                  maxLength={2000}
                  placeholder="https://example.com/leaflet.pdf"
                  error={mediaHalfSet ? "Set both the attachment type and the file link, or neither." : undefined}
                  hint={!mediaHalfSet ? "Must be a direct link — a Drive or Dropbox share page will not work." : undefined}
                />
              </div>
            </div>

            <div className="flex flex-wrap gap-3 pt-2">
              <Button
                type="submit"
                disabled={!canSave || isSaving}
                variant="primary"
                isBusy={isSaving}
                busyLabel="Saving…"
                className="rounded-xl px-4 py-2 font-semibold"
              >
                {draft.id ? "Save template" : "Create template"}
              </Button>
              <Button
                type="button"
                onClick={() => setDraft(null)}
                variant="secondary"
                className="rounded-xl px-4 py-2"
              >
                Cancel
              </Button>
            </div>
          </form>
        </div>
      )}

      {templates.length === 0 ? (
        <div className="rounded-3xl border border-line bg-canvas px-6 py-10 text-center shadow-card">
          <p className="mb-1 font-semibold text-ink">No templates yet</p>
          <p className="text-body text-muted">
            {canManage
              ? "Add one before anything can be sent to patients."
              : "Ask an admin to add one before you can message patients."}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {templates.map((tmpl) => (
            <div
              key={tmpl.id}
              className="rounded-3xl border border-line bg-canvas p-6 sm:p-7 shadow-card flex flex-col justify-between"
            >
              <div>
                <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
                  <h3 className="text-body font-bold text-ink">{tmpl.name}</h3>
                  {tmpl.mediaType && (
                    <span className="rounded-lg bg-canvas-deep px-2 py-0.5 text-micro font-medium text-muted">
                      {tmpl.mediaType}
                    </span>
                  )}
                </div>

                <div className="mt-3 rounded-2xl bg-canvas-deep/40 border border-line/60 p-4 min-h-[140px] flex flex-col justify-between">
                  <p className="whitespace-pre-wrap text-label text-ink leading-relaxed break-words font-normal">
                    {tmpl.body}
                  </p>

                  <div className="mt-4 pt-2 text-micro font-medium text-muted">
                    {clinicName ?? "Sharma Clinic"}
                  </div>
                </div>

                {tmpl.footer && (
                  <p className="mt-2 text-meta text-muted italic">
                    {tmpl.footer}
                  </p>
                )}
              </div>

              {canManage && (
                <div className="mt-5 flex items-center gap-3 pt-3">
                  <button
                    type="button"
                    onClick={() =>
                      setDraft({
                        id: tmpl.id,
                        name: tmpl.name,
                        body: tmpl.body,
                        footer: tmpl.footer ?? "",
                        mediaType: tmpl.mediaType ?? "",
                        mediaUrl: tmpl.mediaUrl ?? "",
                      })
                    }
                    className="inline-flex items-center gap-2 rounded-xl border border-line bg-canvas px-3.5 py-1.5 text-label font-semibold text-ink shadow-sm hover:bg-canvas-deep transition-colors"
                  >
                    <Pencil className="h-3.5 w-3.5 text-muted" aria-hidden="true" />
                    Edit template
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(tmpl.id)}
                    disabled={removingId === tmpl.id}
                    className="text-label font-semibold text-accent hover:underline disabled:opacity-50 transition-colors px-2 py-1"
                  >
                    {removingId === tmpl.id ? "Removing…" : "Remove"}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
