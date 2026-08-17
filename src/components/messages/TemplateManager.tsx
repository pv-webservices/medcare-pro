"use client";

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
import Input, { Select } from "@/components/ui/Input";
import Card from "@/components/ui/Card";

/**
 * The approved message set — PRD §6.9 (FR-9.1).
 *
 * This provider has no template approval of its own, so this list IS the
 * approved set: the send screen can only choose from it, and no endpoint in
 * the app accepts a free-typed body. Editing is gated on `message:template`
 * separately from `message:send`, so the front desk sends the wording but does
 * not rewrite it.
 *
 * Placeholders are validated as you type. A body referring to `{doctrName}`
 * is refused at save rather than going out with a literal brace in it.
 */

interface TemplateManagerProps {
  templates: readonly TemplateRecord[];
  canManage: boolean;
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
        // Covers the 409 for a duplicate name, written for the user by the server.
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
    <section aria-labelledby="templates-heading">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-4">
        <div>
          <h2 id="templates-heading" className="text-lg font-bold text-slate-900">
            Message templates
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Only these can be sent. Nothing else goes out from this account.
          </p>
        </div>
        {canManage && draft === null && (
          <Button onClick={() => setDraft({ ...EMPTY_DRAFT })} variant="commit">
            Add Template
          </Button>
        )}
      </div>

      {error && (
        <p
          role="alert"
          className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600"
        >
          {error}
        </p>
      )}

      {draft && (
        <Card className="mb-6 p-4 sm:p-6 bg-slate-50 border-slate-200">
          <form
            onSubmit={handleSubmit}
            className="grid gap-6"
          >
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
            <label htmlFor="template-body" className="mb-1.5 block text-sm font-medium text-slate-700">
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
              className={`block w-full rounded-md border bg-white px-3 py-2 text-sm outline-none transition-colors focus:ring-2 focus:ring-violet-600/20 ${badTokens.length > 0 ? "border-red-500 focus:border-red-500" : "border-slate-300 focus:border-violet-600"}`}
            />
            <p
              id="template-body-help"
              className={`mt-2 text-xs ${
                badTokens.length > 0
                  ? "text-red-600"
                  : "text-slate-500"
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
                    className="min-h-8 rounded-md border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50 hover:border-slate-300 transition-colors shadow-sm"
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
              placeholder="e.g. Sent by Alpha Clinic"
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
              variant="commit"
              isBusy={isSaving}
              busyLabel="Saving…"
            >
              {draft.id ? "Save Template" : "Create Template"}
            </Button>
            <Button
              type="button"
              onClick={() => setDraft(null)}
              variant="secondary"
            >
              Cancel
            </Button>
          </div>
        </form>
        </Card>
      )}

      {templates.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white px-6 py-8 text-center shadow-sm">
          <p className="mb-1 font-semibold text-slate-900">No templates yet</p>
          <p className="text-sm text-slate-500">
            {canManage
              ? "Add one before anything can be sent to patients."
              : "Ask an admin to add one before you can message patients."}
          </p>
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {templates.map((template) => (
            <li
              key={template.id}
              className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
                <p className="font-semibold text-slate-900">{template.name}</p>
                {template.mediaType && (
                  <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600 border border-slate-200">
                    {template.mediaType}
                  </span>
                )}
              </div>

              <p className="whitespace-pre-wrap text-sm text-slate-700">
                {template.body}
              </p>

              {template.footer && (
                <p className="mt-3 text-xs text-slate-400">
                  {template.footer}
                </p>
              )}

              {canManage && (
                <div className="mt-5 flex flex-wrap gap-2 pt-4 border-t border-slate-100">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() =>
                      setDraft({
                        id: template.id,
                        name: template.name,
                        body: template.body,
                        footer: template.footer ?? "",
                        mediaType: template.mediaType ?? "",
                        mediaUrl: template.mediaUrl ?? "",
                      })
                    }
                  >
                    Edit Template
                  </Button>
                  <button
                    type="button"
                    onClick={() => handleDelete(template.id)}
                    disabled={removingId === template.id}
                    className="min-h-10 rounded-md px-3 text-sm font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-50 transition-colors"
                  >
                    {removingId === template.id ? "Removing…" : "Remove"}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
